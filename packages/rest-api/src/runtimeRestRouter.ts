import { randomUUID } from "node:crypto";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import type { EngineQueue } from "@opencoreagents/adapters-bullmq";
import type { QueueEvents } from "bullmq";
import {
  Agent,
  Session,
  getAgentDefinition,
  listAgentIdsForProject,
  type AgentRuntime,
  type Run,
  type RunStatus,
  type RunStore,
} from "@opencoreagents/core";
import type { RuntimeRestSwaggerOptions } from "./openapi.js";
import {
  buildRuntimeRestOpenApiSpec,
  normalizeRuntimeRestSwaggerPaths,
  runtimeRestSwaggerInfo,
  runtimeRestSwaggerUiHtml,
} from "./openapi.js";
import { isBullmqJobWaitTimeoutError } from "./bullmqJobWaitTimeout.js";
import { mapEngineErrorToHttp } from "./engineErrorHttp.js";
import {
  continueInputsFromState,
  emptyRunStatusSummary,
  historyWithResumeTimeline,
  lastWaitReason,
  loadRunsForSession,
  parseQueryFlag,
  resumeInputsFromState,
} from "./runInspect.js";
import { summarizeEngineRun, summarizeRunListEntry } from "./summarizeRun.js";

/** BullMQ enqueue path — same payload shape as **`examples/dynamic-runtime-rest`** (`addRun` / `addResume` / `addContinue`). */
export interface RuntimeRestDispatchOptions {
  engine: EngineQueue;
  /**
   * **`QueueEvents`** for the **same** queue name as **`engine`** — required when clients use **`?wait=1`**
   * or JSON **`"wait": true`** (blocking until the worker finishes the job).
   */
  queueEvents?: QueueEvents;
  /** **`waitUntilFinished`** timeout when **`wait`** is set (default **120_000** ms). */
  jobWaitTimeoutMs?: number;
}

export interface RuntimeRestPluginOptions {
  /**
   * Used for **inline** **`Agent.run` / `resume`** when **`dispatch`** is unset, and for **`GET /agents/:agentId/memory`** (when set).
   * When **`dispatch`** is set without **`runtime`**, there is **no** memory HTTP route (enqueue-only API).
   */
  runtime?: AgentRuntime;
  /**
   * When set, **`POST …/run`**, **`POST …/resume`**, and **`POST …/continue`** **enqueue** via **`engine.addRun` / `addResume` / `addContinue`**
   * (async worker — configure **`AgentRuntime`** + **`dispatch`** on the worker like **`dynamic-runtime-rest`**).
   * Responses default to **202** + **`jobId`** + **`statusUrl`**; use **`?wait=1`** or **`"wait": true`** in the body to block (needs **`queueEvents`**).
   */
  dispatch?: RuntimeRestDispatchOptions;
  /**
   * Fixed tenant: every request uses this **`Session.projectId`** (clients cannot override).
   * Omit for **multi-project** mode: resolve per request via **`resolveProjectId`**
   * (default: header **`X-Project-Id`**, then **`?projectId=`**, then **`body.projectId`** on POST JSON).
   */
  projectId?: string;
  /**
   * When set (non-empty), only these **`projectId`** values are accepted (fixed or resolved).
   * Include **`"*"`** as the sole entry (or alongside others) to allow **any** resolved project id
   * while still using per-request resolution — pair with **`apiKey`** / **`resolveProjectId`** in production.
   */
  allowedProjectIds?: readonly string[];
  /**
   * Override how the tenant is chosen when **`projectId`** is omitted.
   * Return a non-empty string, or **`undefined`** / empty to yield **400**.
   */
  resolveProjectId?: (req: Request) => string | undefined;
  /**
   * Optional allowlist: intersected with the in-process registry for the effective **`projectId`**
   * — only defined agents appear on **`GET /agents`** and **`POST …/run`** / **`resume`** / **`continue`** return **404** for unknown ids.
   */
  agentIds?: readonly string[];
  /**
   * Required for **inline** **`POST …/resume`** and **`POST …/continue`**, **`GET /runs/:runId`**, **`GET /runs/:runId/history`**, and **`GET /agents/:agentId/runs`**.
   * Omit on the API when only **`dispatch`** handles run/resume (worker owns **`RunStore`**); those routes then return **501**.
   */
  runStore?: RunStore;
  /**
   * Static secret: require `Authorization: Bearer <key>` or `X-Api-Key: <key>` when non-empty.
   * Prefer **`resolveApiKey`** for lazy env reads or per-tenant keys.
   */
  apiKey?: string;
  /**
   * Expected secret per request. Runs **after** tenant resolution — use **`getRuntimeRestRouterProjectId(res)`**
   * for a key per **`projectId`** (env map, vault, etc.).
   * If it returns a non-empty string, that value is used; otherwise **`apiKey`** is used as fallback.
   * If both are unset or both yield empty for a request, that request skips API-key auth.
   */
  resolveApiKey?: (req: Request, res: Response) => string | undefined;
  /**
   * Expose **OpenAPI JSON** + **Swagger UI** on the same router (no extra npm deps — UI loads from **unpkg**).
   * These routes are registered **before** tenant + API-key middleware so **`GET /docs`** and **`GET /openapi.json`**
   * do not require **`X-Project-Id`** or auth (add your own **`app.use`** if you need to lock them down).
   */
  swagger?: boolean | RuntimeRestSwaggerOptions;
}

const localsKey = "runtimeRestProjectId" as const;

/**
 * Effective **`projectId`** for this request after tenant middleware (same value **`Session`** uses).
 * Use inside **`resolveApiKey(req, res)`** to pick a secret per project.
 */
export function getRuntimeRestRouterProjectId(res: Response): string | undefined {
  return (res.locals as Record<string, string | undefined>)[localsKey];
}

function getRuntimeRestProjectId(res: Response): string {
  const id = getRuntimeRestRouterProjectId(res);
  if (!id) throw new Error("runtimeRestProjectId missing (middleware order)");
  return id;
}

/** Default tenant resolution when `options.projectId` is omitted. */
export function defaultRuntimeRestResolveProjectId(req: Request): string | undefined {
  const h = req.header("x-project-id")?.trim();
  if (h) return h;
  const q = req.query.projectId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const body = req.body;
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { projectId?: unknown }).projectId === "string"
  ) {
    const p = (body as { projectId: string }).projectId.trim();
    if (p) return p;
  }
  return undefined;
}

function resultText(run: Run): string | undefined {
  const last = run.history.filter((h) => h.type === "result").pop();
  return last && typeof last.content === "string" ? last.content : undefined;
}

function optionalApiKeyAuth(config: {
  apiKey?: string;
  resolveApiKey?: (req: Request, res: Response) => string | undefined;
}): RequestHandler {
  const staticTrimmed = config.apiKey?.trim();
  const resolveApiKey = config.resolveApiKey;
  if (!staticTrimmed && !resolveApiKey) {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    let expected: string | undefined;
    if (resolveApiKey) {
      const r = resolveApiKey(req, res);
      if (typeof r === "string" && r.trim() !== "") {
        expected = r.trim();
      }
    }
    if (expected === undefined) {
      expected = staticTrimmed || undefined;
    }
    if (!expected) {
      next();
      return;
    }
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "")?.trim();
    const headerKey = req.header("x-api-key")?.trim();
    const key = bearer || headerKey || "";
    if (key !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

/**
 * Same **`Authorization: Bearer …`** / **`X-Api-Key`** checks as {@link createRuntimeRestRouter}’s internal middleware.
 * Use to protect routes **outside** that router (e.g. admin mounts) with the same secret.
 */
export function createOptionalRuntimeRestApiKeyMiddleware(options: {
  apiKey?: string;
  resolveApiKey?: (req: Request, res: Response) => string | undefined;
}): RequestHandler {
  return optionalApiKeyAuth(options);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRunLike(v: unknown): v is Run {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.runId === "string" && typeof r.status === "string" && Array.isArray(r.history);
}

const RUN_STATUS_SET = new Set<RunStatus>(["running", "waiting", "completed", "failed"]);

function parseRunListLimit(q: unknown): number {
  if (typeof q !== "string" || !q.trim()) return 50;
  const n = Number.parseInt(q.trim(), 10);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(1, n));
}

function runMatchesListTenant(run: Run, effectiveProjectId: string): boolean {
  if (run.projectId != null) return run.projectId === effectiveProjectId;
  return true;
}

const MAX_BUS_AGENT_ID_LEN = 256;
const MAX_BUS_CORRELATION_ID_LEN = 256;

function isBusMessageType(v: unknown): v is "request" | "reply" | "event" {
  return v === "request" || v === "reply" || v === "event";
}

type ParsedInterAgentSend =
  | {
      ok: true;
      toAgentId: string;
      payload: unknown;
      type: "request" | "reply" | "event";
      correlationId?: string;
      sessionId?: string;
      endUserId?: string;
    }
  | { ok: false; error: string };

/** Same rules as **`system_send_message`** (`@opencoreagents/core`). */
function parseInterAgentSendBody(body: unknown, fromAgentIdRaw: string): ParsedInterAgentSend {
  const fromId = fromAgentIdRaw.trim();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON body must be an object" };
  }
  const o = body as Record<string, unknown>;
  if (typeof o.toAgentId !== "string" || !o.toAgentId.trim()) {
    return { ok: false, error: "body.toAgentId is required" };
  }
  const toRaw = o.toAgentId;
  if (toRaw.length > MAX_BUS_AGENT_ID_LEN) {
    return { ok: false, error: "body.toAgentId is too long" };
  }
  const toId = toRaw.trim();
  if (toId === fromId) {
    return { ok: false, error: "toAgentId cannot match the sending agent" };
  }
  if (!("payload" in o)) {
    return { ok: false, error: "body.payload is required" };
  }

  let msgType: "request" | "reply" | "event" = "event";
  const t = o.type;
  if (t !== undefined) {
    if (!isBusMessageType(t)) {
      return { ok: false, error: "body.type must be event, request, or reply" };
    }
    msgType = t;
  }

  let correlationId: string | undefined;
  if (msgType === "request" || msgType === "reply") {
    if (typeof o.correlationId !== "string" || !o.correlationId.trim()) {
      return { ok: false, error: "body.correlationId is required for type request or reply" };
    }
    const cRaw = o.correlationId;
    if (cRaw.length > MAX_BUS_CORRELATION_ID_LEN) {
      return { ok: false, error: "body.correlationId is too long" };
    }
    correlationId = cRaw.trim();
  } else if (o.correlationId !== undefined) {
    if (typeof o.correlationId !== "string") {
      return { ok: false, error: "body.correlationId must be a string" };
    }
    if (o.correlationId.length > MAX_BUS_CORRELATION_ID_LEN) {
      return { ok: false, error: "body.correlationId is too long" };
    }
    const c = o.correlationId.trim();
    if (c) correlationId = c;
  }

  let sessionId: string | undefined;
  if (o.sessionId !== undefined) {
    if (typeof o.sessionId !== "string" || !o.sessionId.trim()) {
      return { ok: false, error: "body.sessionId must be a non-empty string when set" };
    }
    sessionId = o.sessionId.trim();
  }

  let endUserId: string | undefined;
  if (o.endUserId !== undefined) {
    if (typeof o.endUserId !== "string" || !o.endUserId.trim()) {
      return { ok: false, error: "body.endUserId must be a non-empty string when set" };
    }
    endUserId = o.endUserId.trim();
  }

  return {
    ok: true,
    toAgentId: toId,
    payload: o.payload,
    type: msgType,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(endUserId !== undefined ? { endUserId } : {}),
  };
}

/** Shared **`runStore.load`** + session / tenant checks for **`GET /runs/:runId`** and **`GET /runs/:runId/history`**. */
async function loadRunForTenantScopedRead(
  runStore: RunStore,
  runId: string,
  sessionId: string,
  projectId: string,
): Promise<
  | { ok: true; run: Run }
  | { ok: false; status: number; body: { error: string } }
> {
  const run = await runStore.load(runId);
  if (!run) return { ok: false, status: 404, body: { error: "run not found" } };
  if (run.sessionId != null && run.sessionId !== sessionId) {
    return { ok: false, status: 403, body: { error: "sessionId does not match this run" } };
  }
  if (run.projectId != null && run.projectId !== projectId) {
    return { ok: false, status: 403, body: { error: "projectId does not match this run" } };
  }
  return { ok: true, run };
}

function parseWait(req: Request): boolean {
  return (
    req.query.wait === "1" ||
    req.query.wait === "true" ||
    (typeof (req.body as { wait?: unknown })?.wait === "boolean" &&
      (req.body as { wait: boolean }).wait === true)
  );
}

function statusUrl(req: Request, jobId: string): string {
  const base = req.baseUrl.endsWith("/") ? req.baseUrl.slice(0, -1) : req.baseUrl;
  return `${base}/jobs/${jobId}`;
}

/**
 * Express **`Router`** with JSON routes for agents, runs, and optional BullMQ jobs
 * (URL contract in **`docs/planning/plan-rest.md`**).
 * Mount with **`app.use(createRuntimeRestRouter({ … }))`** (or under a prefix like **`/api`**).
 *
 * **Execution:** provide **`runtime`** for **inline** runs, **`GET /agents/:agentId/memory`** ( **`MemoryAdapter.query`** ), and **`POST /agents/:fromAgentId/send`** when **`runtime.config.messageBus`** is set (**501** otherwise), **`dispatch`** for **BullMQ** enqueue (like **`dynamic-runtime-rest`**), or **both** (dispatch wins for **`POST` run/resume** — memory + send routes still follow **`runtime`**).
 *
 * **Tenancy:** pass **`projectId`** for a single fixed tenant, or omit it and resolve per request
 * (**`defaultRuntimeRestResolveProjectId`**: header **`X-Project-Id`**, **`?projectId=`**, then **`body.projectId`** on POST).
 */
export function createRuntimeRestRouter(options: RuntimeRestPluginOptions): Router {
  const {
    runtime,
    dispatch,
    projectId: fixedProjectId,
    allowedProjectIds,
    resolveProjectId = defaultRuntimeRestResolveProjectId,
    agentIds,
    runStore,
    apiKey,
    resolveApiKey,
    swagger: swaggerOption,
  } = options;

  if (!dispatch && !runtime) {
    throw new Error(
      "createRuntimeRestRouter: provide `runtime` (inline Agent.run) and/or `dispatch` ({ engine, … }) for BullMQ — at least one is required.",
    );
  }

  const jobWaitMs = dispatch?.jobWaitTimeoutMs ?? 120_000;
  const allowlist = agentIds !== undefined ? new Set(agentIds) : null;
  const allowAllProjects = allowedProjectIds?.includes("*") === true;
  const allowedProjectsExclusive =
    !allowAllProjects &&
    allowedProjectIds !== undefined &&
    allowedProjectIds.length > 0
      ? new Set(allowedProjectIds.filter((id) => id !== "*"))
      : null;

  function agentsListedForProject(projectId: string): string[] {
    if (allowlist !== null) {
      return [...allowlist]
        .filter((id) => getAgentDefinition(projectId, id) !== undefined)
        .sort();
    }
    return listAgentIdsForProject(projectId);
  }

  function isRunnableAgent(projectId: string, agentId: string): boolean {
    if (getAgentDefinition(projectId, agentId) === undefined) return false;
    if (allowlist !== null && !allowlist.has(agentId)) return false;
    return true;
  }

  const resolveEffectiveProjectId: RequestHandler = (req, res, next) => {
    let pid: string | undefined;
    if (fixedProjectId !== undefined && fixedProjectId.trim() !== "") {
      pid = fixedProjectId.trim();
    } else {
      pid = resolveProjectId(req)?.trim();
      if (!pid) {
        res.status(400).json({
          error:
            "projectId required: set option projectId, or send header X-Project-Id, query ?projectId=, or JSON body.projectId (POST)",
        });
        return;
      }
    }
    if (
      allowedProjectsExclusive !== null &&
      !allowedProjectsExclusive.has(pid)
    ) {
      res.status(403).json({ error: "unknown project" });
      return;
    }
    (res.locals as Record<string, string>)[localsKey] = pid;
    next();
  };

  const r = express.Router();
  r.use(express.json({ limit: "512kb" }));

  const swaggerPaths = normalizeRuntimeRestSwaggerPaths(swaggerOption);
  if (swaggerPaths) {
    const multiProjectOpenApi = !(fixedProjectId !== undefined && fixedProjectId.trim() !== "");
    const swaggerInfo = runtimeRestSwaggerInfo(swaggerOption);
    let spec: Record<string, unknown> = buildRuntimeRestOpenApiSpec({
      hasDispatch: !!dispatch,
      hasMemoryRead: !!runtime,
      hasInterAgentSend: !!runtime,
      hasRunStore: !!runStore,
      multiProject: multiProjectOpenApi,
      hasApiKey: !!(apiKey?.trim() || resolveApiKey),
      title: swaggerInfo?.title,
      version: swaggerInfo?.version,
      description: swaggerInfo?.description,
    });
    if (swaggerOption !== true && typeof swaggerOption === "object" && swaggerOption.extendOpenApi) {
      spec = swaggerOption.extendOpenApi(spec) ?? spec;
    }
    const html = runtimeRestSwaggerUiHtml(swaggerPaths.openApiPath, swaggerPaths.uiPath);
    r.get(`/${swaggerPaths.openApiPath}`, (_req, res) => {
      res.type("application/json; charset=utf-8").json(spec);
    });
    r.get(`/${swaggerPaths.uiPath}`, (_req, res) => {
      res.type("text/html; charset=utf-8").send(html);
    });
  }

  r.use(resolveEffectiveProjectId);
  r.use(optionalApiKeyAuth({ apiKey, resolveApiKey }));

  r.get("/agents", (_req, res) => {
    const projectId = getRuntimeRestProjectId(res);
    const ids = agentsListedForProject(projectId);
    res.json({
      projectId,
      agents: ids.map((id) => ({ id })),
    });
  });

  if (runtime) {
    r.get("/agents/:agentId/memory", async (req, res) => {
      const projectId = getRuntimeRestProjectId(res);
      const { agentId } = req.params;
      if (!isRunnableAgent(projectId, agentId)) {
        res.status(404).json({ error: "unknown agent" });
        return;
      }

      const sessionIdRaw = req.query.sessionId;
      const sessionId =
        typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : "";
      if (!sessionId) {
        res.status(400).json({ error: "Query ?sessionId= is required" });
        return;
      }

      const memoryTypeRaw = req.query.memoryType;
      const memoryType =
        typeof memoryTypeRaw === "string" && memoryTypeRaw.trim()
          ? memoryTypeRaw.trim()
          : "";
      if (!memoryType) {
        res.status(400).json({ error: "Query ?memoryType= is required" });
        return;
      }

      const endUserIdRaw = req.query.endUserId;
      const endUserId =
        typeof endUserIdRaw === "string" && endUserIdRaw.trim()
          ? endUserIdRaw.trim()
          : undefined;

      try {
        const items = await runtime.config.memoryAdapter.query(
          { projectId, agentId, sessionId, endUserId },
          memoryType,
        );
        res.json({
          projectId,
          agentId,
          sessionId,
          memoryType,
          ...(endUserId !== undefined ? { endUserId } : {}),
          items,
        });
      } catch (e) {
        const mapped = mapEngineErrorToHttp(e);
        if (mapped) {
          res.status(mapped.status).json(mapped.body);
          return;
        }
        res.status(500).json({ error: errorMessage(e) });
      }
    });

    r.post("/agents/:fromAgentId/send", async (req, res) => {
      const bus = runtime.config.messageBus;
      if (!bus) {
        res.status(501).json({ error: "messageBus is required on AgentRuntime" });
        return;
      }

      const projectId = getRuntimeRestProjectId(res);
      const { fromAgentId } = req.params;
      if (!isRunnableAgent(projectId, fromAgentId)) {
        res.status(404).json({ error: "unknown agent" });
        return;
      }

      const parsed = parseInterAgentSendBody(req.body, fromAgentId);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const policy = runtime.config.sendMessageTargetPolicy;
      if (policy) {
        const allowed = policy({
          fromAgentId,
          toAgentId: parsed.toAgentId,
          projectId,
          sessionId: parsed.sessionId ?? "",
          endUserId: parsed.endUserId,
        });
        if (!allowed) {
          res.status(403).json({ error: "target agent is not allowed for this sender" });
          return;
        }
      }

      try {
        await bus.send({
          fromAgentId,
          toAgentId: parsed.toAgentId,
          projectId,
          type: parsed.type,
          payload: parsed.payload,
          ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
          ...(parsed.correlationId !== undefined ? { correlationId: parsed.correlationId } : {}),
          meta: { ts: new Date().toISOString() },
        });
        res.json({
          projectId,
          fromAgentId,
          toAgentId: parsed.toAgentId,
          type: parsed.type,
          success: true,
          ...(parsed.correlationId !== undefined ? { correlationId: parsed.correlationId } : {}),
        });
      } catch (e) {
        const mapped = mapEngineErrorToHttp(e);
        if (mapped) {
          res.status(mapped.status).json(mapped.body);
          return;
        }
        res.status(500).json({ error: errorMessage(e) });
      }
    });
  }

  r.post("/agents/:agentId/run", async (req, res) => {
    const projectId = getRuntimeRestProjectId(res);
    const { agentId } = req.params;
    if (!isRunnableAgent(projectId, agentId)) {
      res.status(404).json({ error: "unknown agent" });
      return;
    }

    const body = req.body as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      res.status(400).json({ error: "message (string) required" });
      return;
    }

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID();

    if (dispatch) {
      const wait = parseWait(req);
      let jobId = "";
      try {
        const job = await dispatch.engine.addRun({
          projectId,
          agentId,
          sessionId,
          userInput: body.message.trim(),
        });
        jobId = job.id ?? "";
        if (!jobId) {
          res.status(500).json({ sessionId, error: "enqueue failed (missing job id)" });
          return;
        }

        if (!wait) {
          const url = statusUrl(req, jobId);
          res.status(202).json({
            jobId,
            sessionId,
            projectId,
            statusUrl: url,
            pollUrl: url,
          });
          return;
        }

        if (!dispatch.queueEvents) {
          res.status(501).json({
            error: "dispatch.queueEvents is required when using wait=1 or body.wait true",
          });
          return;
        }

        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(dispatch.queueEvents, jobWaitMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res.status(504).json({ jobId, sessionId, projectId, error: msg });
            return;
          }
          res.status(502).json({ jobId, sessionId, projectId, error: msg });
          return;
        }

        if (isRunLike(finishedValue)) {
          const s = summarizeEngineRun(finishedValue);
          res.json({
            jobId,
            sessionId,
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        const fromJob = job.returnvalue;
        if (isRunLike(fromJob)) {
          const s = summarizeEngineRun(fromJob);
          res.json({
            jobId,
            sessionId,
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        res.status(500).json({
          jobId,
          sessionId,
          error: "job finished but return value is missing or not a Run",
        });
      } catch (e) {
        res.status(503).json({ sessionId, error: errorMessage(e) });
      }
      return;
    }

    if (!runtime) {
      res.status(501).json({ error: "runtime is required for inline run when dispatch is not set" });
      return;
    }

    try {
      const session = new Session({ id: sessionId, projectId });
      const agent = await Agent.load(agentId, runtime, { session });
      const run = await agent.run(body.message.trim());

      const payload: Record<string, unknown> = {
        sessionId,
        runId: run.runId,
        projectId,
        status: run.status,
      };
      const reply = resultText(run);
      if (reply !== undefined) payload.reply = reply;
      if (run.status === "waiting") {
        const hint: Record<string, unknown> = {
          method: "POST",
          path: `/agents/${agentId}/resume`,
          body: {
            runId: run.runId,
            sessionId,
            resumeInput: { type: "text", content: "<user follow-up>" },
          },
        };
        if (fixedProjectId === undefined || fixedProjectId.trim() === "") {
          hint.headers = { "X-Project-Id": projectId };
          (hint.body as Record<string, unknown>).projectId = projectId;
        }
        payload.resumeHint = hint;
      }

      res.json(payload);
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.post("/agents/:agentId/resume", async (req, res) => {
    if (!dispatch && !runStore) {
      res.status(501).json({ error: "runStore is required for inline resume" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);
    const { agentId } = req.params;
    if (!isRunnableAgent(projectId, agentId)) {
      res.status(404).json({ error: "unknown agent" });
      return;
    }

    const body = req.body as {
      runId?: unknown;
      sessionId?: unknown;
      resumeInput?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      res.status(400).json({ error: "runId (string) required" });
      return;
    }
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      res.status(400).json({ error: "sessionId (string) required" });
      return;
    }
    const ri = body.resumeInput;
    if (
      ri == null ||
      typeof ri !== "object" ||
      typeof (ri as { type?: unknown }).type !== "string" ||
      typeof (ri as { content?: unknown }).content !== "string"
    ) {
      res.status(400).json({
        error: "resumeInput required: { type: string, content: string }",
      });
      return;
    }
    const resumeInput = ri as { type: string; content: string };

    if (dispatch) {
      const wait = parseWait(req);
      let jobId = "";
      try {
        const job = await dispatch.engine.addResume({
          projectId,
          agentId,
          sessionId: body.sessionId.trim(),
          runId: body.runId.trim(),
          resumeInput,
        });
        jobId = job.id ?? "";
        if (!jobId) {
          res.status(500).json({ error: "enqueue failed (missing job id)" });
          return;
        }

        if (!wait) {
          const url = statusUrl(req, jobId);
          res.status(202).json({
            jobId,
            sessionId: body.sessionId.trim(),
            runId: body.runId.trim(),
            projectId,
            statusUrl: url,
            pollUrl: url,
          });
          return;
        }

        if (!dispatch.queueEvents) {
          res.status(501).json({
            error: "dispatch.queueEvents is required when using wait=1 or body.wait true",
          });
          return;
        }

        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(dispatch.queueEvents, jobWaitMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          const sid = body.sessionId.trim();
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res.status(504).json({ jobId, sessionId: sid, projectId, error: msg });
            return;
          }
          res.status(502).json({ jobId, sessionId: sid, projectId, error: msg });
          return;
        }

        if (isRunLike(finishedValue)) {
          const s = summarizeEngineRun(finishedValue);
          res.json({
            jobId,
            sessionId: body.sessionId.trim(),
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        const fromJob = job.returnvalue;
        if (isRunLike(fromJob)) {
          const s = summarizeEngineRun(fromJob);
          res.json({
            jobId,
            sessionId: body.sessionId.trim(),
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        res.status(500).json({
          jobId,
          error: "job finished but return value is missing or not a Run",
        });
      } catch (e) {
        res.status(503).json({ error: errorMessage(e) });
      }
      return;
    }

    if (!runtime) {
      res.status(501).json({ error: "runtime is required for inline resume when dispatch is not set" });
      return;
    }

    try {
      const session = new Session({
        id: body.sessionId.trim(),
        projectId,
      });
      const agent = await Agent.load(agentId, runtime, { session });
      const run = await agent.resume(body.runId.trim(), resumeInput);

      const payload: Record<string, unknown> = {
        sessionId: body.sessionId.trim(),
        runId: run.runId,
        projectId,
        status: run.status,
      };
      const reply = resultText(run);
      if (reply !== undefined) payload.reply = reply;

      res.json(payload);
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(400).json({ error: errorMessage(e) });
    }
  });

  r.post("/agents/:agentId/continue", async (req, res) => {
    if (!dispatch && !runStore) {
      res.status(501).json({ error: "runStore is required for inline continue" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);
    const { agentId } = req.params;
    if (!isRunnableAgent(projectId, agentId)) {
      res.status(404).json({ error: "unknown agent" });
      return;
    }

    const body = req.body as {
      runId?: unknown;
      sessionId?: unknown;
      message?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      res.status(400).json({ error: "runId (string) required" });
      return;
    }
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      res.status(400).json({ error: "sessionId (string) required" });
      return;
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      res.status(400).json({ error: "message (string) required" });
      return;
    }

    if (dispatch) {
      const wait = parseWait(req);
      let jobId = "";
      try {
        const job = await dispatch.engine.addContinue({
          projectId,
          agentId,
          sessionId: body.sessionId.trim(),
          runId: body.runId.trim(),
          userInput: body.message.trim(),
        });
        jobId = job.id ?? "";
        if (!jobId) {
          res.status(500).json({ error: "enqueue failed (missing job id)" });
          return;
        }

        if (!wait) {
          const url = statusUrl(req, jobId);
          res.status(202).json({
            jobId,
            sessionId: body.sessionId.trim(),
            runId: body.runId.trim(),
            projectId,
            statusUrl: url,
            pollUrl: url,
          });
          return;
        }

        if (!dispatch.queueEvents) {
          res.status(501).json({
            error: "dispatch.queueEvents is required when using wait=1 or body.wait true",
          });
          return;
        }

        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(dispatch.queueEvents, jobWaitMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          const sid = body.sessionId.trim();
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res.status(504).json({ jobId, sessionId: sid, projectId, error: msg });
            return;
          }
          res.status(502).json({ jobId, sessionId: sid, projectId, error: msg });
          return;
        }

        if (isRunLike(finishedValue)) {
          const s = summarizeEngineRun(finishedValue);
          res.json({
            jobId,
            sessionId: body.sessionId.trim(),
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        const fromJob = job.returnvalue;
        if (isRunLike(fromJob)) {
          const s = summarizeEngineRun(fromJob);
          res.json({
            jobId,
            sessionId: body.sessionId.trim(),
            projectId,
            runId: s.runId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        res.status(500).json({
          jobId,
          error: "job finished but return value is missing or not a Run",
        });
      } catch (e) {
        res.status(503).json({ error: errorMessage(e) });
      }
      return;
    }

    if (!runtime) {
      res.status(501).json({
        error: "runtime is required for inline continue when dispatch is not set",
      });
      return;
    }

    try {
      const session = new Session({
        id: body.sessionId.trim(),
        projectId,
      });
      const agent = await Agent.load(agentId, runtime, { session });
      const run = await agent.continueRun(body.runId.trim(), body.message.trim());

      const payload: Record<string, unknown> = {
        sessionId: body.sessionId.trim(),
        runId: run.runId,
        projectId,
        status: run.status,
      };
      const reply = resultText(run);
      if (reply !== undefined) payload.reply = reply;

      res.json(payload);
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(400).json({ error: errorMessage(e) });
    }
  });

  r.get("/agents/:agentId/runs", async (req, res) => {
    if (!runStore) {
      res.status(501).json({ error: "runStore is required" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);
    const { agentId } = req.params;
    if (!isRunnableAgent(projectId, agentId)) {
      res.status(404).json({ error: "unknown agent" });
      return;
    }

    const statusRaw = req.query.status;
    let statusFilter: RunStatus | undefined;
    if (typeof statusRaw === "string" && statusRaw.trim()) {
      const s = statusRaw.trim() as RunStatus;
      if (!RUN_STATUS_SET.has(s)) {
        res.status(400).json({
          error: "invalid status (expected running, waiting, completed, or failed)",
        });
        return;
      }
      statusFilter = s;
    }

    const sessionFilterRaw = req.query.sessionId;
    const sessionFilter =
      typeof sessionFilterRaw === "string" && sessionFilterRaw.trim()
        ? sessionFilterRaw.trim()
        : undefined;

    const limit = parseRunListLimit(req.query.limit);

    try {
      let rows = await runStore.listByAgent(agentId, statusFilter);
      rows = rows.filter(
        (run) =>
          runMatchesListTenant(run, projectId) &&
          (sessionFilter === undefined || run.sessionId === sessionFilter),
      );
      rows = rows.slice(0, limit);

      res.json({
        projectId,
        agentId,
        limit,
        runs: rows.map((run) => summarizeRunListEntry(run)),
      });
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.get("/sessions/:sessionId/status", async (req, res) => {
    if (!runStore) {
      res.status(501).json({ error: "runStore is required" });
      return;
    }

    const sessionId = req.params.sessionId?.trim() ?? "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);
    const light = parseQueryFlag(req.query.light);

    try {
      const agentIds = agentsListedForProject(projectId);
      const runs = await loadRunsForSession(runStore, { sessionId, projectId, agentIds });
      const byStatus = emptyRunStatusSummary();
      for (const r of runs) {
        byStatus[r.status] += 1;
      }

      res.json({
        sessionId,
        projectId,
        runs: runs.map((r) => {
          const merged = historyWithResumeTimeline(r);
          const userInput = typeof r.state.userInput === "string" ? r.state.userInput : undefined;
          const resumeInputs = resumeInputsFromState(r);
          const continueInputs = continueInputsFromState(r);
          const base = {
            runId: r.runId,
            agentId: r.agentId,
            ...(r.sessionId !== undefined ? { sessionId: r.sessionId } : {}),
            ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
            status: r.status,
            ...(userInput !== undefined ? { userInput } : {}),
            ...(resumeInputs ? { resumeInputs } : {}),
            ...(continueInputs ? { continueInputs } : {}),
            historyStepCount: merged.length,
            reply: resultText(r),
            ...(r.status === "waiting" ? { waitReason: lastWaitReason(r) } : {}),
            iteration: r.state.iteration,
          };
          return light ? base : { ...base, history: merged };
        }),
        summary: { total: runs.length, byStatus },
      });
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.get("/runs/:runId/history", async (req, res) => {
    if (!runStore) {
      res.status(501).json({ error: "runStore is required" });
      return;
    }

    const { runId } = req.params;
    const q = req.query.sessionId;
    const sessionId = typeof q === "string" && q.trim() ? q.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "Query ?sessionId= is required" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);
    const wantTimeline = parseQueryFlag(req.query.timeline);

    try {
      const loaded = await loadRunForTenantScopedRead(runStore, runId, sessionId, projectId);
      if (!loaded.ok) {
        res.status(loaded.status).json(loaded.body);
        return;
      }
      const run = loaded.run;
      const history = wantTimeline ? historyWithResumeTimeline(run) : run.history;
      res.json({
        runId: run.runId,
        agentId: run.agentId,
        ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
        ...(run.projectId !== undefined ? { projectId: run.projectId } : {}),
        status: run.status,
        history,
      });
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.get("/runs/:runId", async (req, res) => {
    if (!runStore) {
      res.status(501).json({ error: "runStore is required" });
      return;
    }

    const { runId } = req.params;
    const q = req.query.sessionId;
    const sessionId = typeof q === "string" && q.trim() ? q.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "Query ?sessionId= is required" });
      return;
    }

    const projectId = getRuntimeRestProjectId(res);

    try {
      const loaded = await loadRunForTenantScopedRead(runStore, runId, sessionId, projectId);
      if (!loaded.ok) {
        res.status(loaded.status).json(loaded.body);
        return;
      }
      const run = loaded.run;

      const userInput =
        typeof run.state.userInput === "string" ? run.state.userInput : undefined;
      const wantTimeline = parseQueryFlag(req.query.timeline);
      const merged = wantTimeline ? historyWithResumeTimeline(run) : null;
      const resumeInputs = resumeInputsFromState(run);
      const continueInputs = continueInputsFromState(run);

      res.json({
        runId: run.runId,
        agentId: run.agentId,
        sessionId: run.sessionId,
        ...(run.projectId !== undefined ? { projectId: run.projectId } : {}),
        status: run.status,
        ...(userInput !== undefined ? { userInput } : {}),
        ...(resumeInputs ? { resumeInputs } : {}),
        ...(continueInputs ? { continueInputs } : {}),
        ...(run.status === "waiting" ? { waitReason: lastWaitReason(run) } : {}),
        reply: resultText(run),
        iteration: run.state.iteration,
        historyStepCount: merged ? merged.length : run.history.length,
        ...(wantTimeline && merged ? { history: merged } : {}),
      });
    } catch (e) {
      const mapped = mapEngineErrorToHttp(e);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  if (dispatch) {
    r.get("/jobs/:jobId", async (req, res) => {
      try {
        const job = await dispatch.engine.queue.getJob(req.params.jobId);
        if (!job) {
          res.status(404).json({ error: "job not found" });
          return;
        }
        const state = await job.getState();
        const failedReason = job.failedReason;
        const returnvalue = job.returnvalue as Run | undefined;
        res.json({
          id: job.id,
          state,
          failedReason: failedReason || undefined,
          run:
            returnvalue && state === "completed" && isRunLike(returnvalue)
              ? summarizeEngineRun(returnvalue)
              : undefined,
        });
      } catch (e) {
        res.status(500).json({ error: errorMessage(e) });
      }
    });
  }

  return r;
}
