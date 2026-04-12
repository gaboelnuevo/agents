/**
 * Express **host** in front of **AgentRuntime**: one process-global runtime, JSON API, optional OpenAI or Anthropic.
 *
 * ## Routes in *this* example (shape is **not** `docs/plan-rest.md`)
 *
 * Use **`@opencoreagents/rest-api`** + **`createRuntimeRestRouter`** when you want the documented contract
 * (`GET /agents`, `POST /agents/:id/run`, `GET /runs/:id/history`, `POST /agents/:from/send`, …). This file is a
 * **custom BFF**: chat-first URLs, SSE, and session-scoped dashboards.
 *
 * | Area | Method | Path | Role |
 * |------|--------|------|------|
 * | Public | GET | `/health` | LLM env + whether `/v1` needs `API_KEY` |
 * | Public | GET | `/status` | Uptime, PID, Node version (probe-friendly) |
 * | Public | GET | `/` | Static UI (`public/`) |
 * | `/v1` | POST | `/v1/chat` | Body `{ message, sessionId? }` → `Agent.run` (blocking JSON) |
 * | `/v1` | POST | `/v1/chat/stream` | Same body → **SSE** (`step`, `observation`, `done`) via run hooks |
 * | `/v1` | GET | `/v1/runs/:runId?sessionId=` | Load run; **`history`** = display timeline (see below) |
 * | `/v1` | GET | `/v1/sessions/:sessionId/status` | All runs for session (both agents); **`?light=1`** drops per-run **`history`** |
 * | `/v1` | POST | `/v1/runs/wait-demo` | Starts wait/resume demo run; **202** + `resumeWith` when `waiting` |
 * | `/v1` | POST | `/v1/runs/:runId/resume` | Body `{ sessionId, text }` → `Agent.resume` (not `resumeInput: { type, content }` like plan-rest) |
 *
 * Optional **`Authorization: Bearer <API_KEY>`** on **`/v1/*`** only. Fixed **`PROJECT_ID`** (no `X-Project-Id` flow).
 *
 * ## `history` vs **`Run.history`** vs plan-rest
 *
 * - **Persisted store:** `RunStore` holds the engine’s **`Run.history`** (`ProtocolMessage[]`) — same as core.
 * - **Resume text** lives in **`run.state.resumeInputs`**, *not* as normal history rows; the UI would miss it if we
 *   only echoed raw `history`.
 * - **`historyWithResumeTimeline()`** here builds a **client-facing** timeline: after each **`wait`** step it inserts a
 *   synthetic **`observation`** (`{ kind: "resume_input", text }`) so chat UIs show user follow-ups between wait and result.
 *   That merged array is **not** written back to the store.
 * - **plan-rest** instead exposes raw steps on **`GET /runs/:runId/history`** (library router) and a compact snapshot on
 *   **`GET /runs/:runId`** (`historyStepCount`, no inlined resume timeline). This example does **not** mount that router.
 *
 * “Real” host touches (not in the engine): **CORS**, **security headers**, **`public/`**, **X-Request-Id**, **404** JSON,
 * **graceful shutdown**. Still not multi-tenant authZ — see `docs/core/08-scope-and-security.md`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
import {
  Agent,
  AgentRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  Session,
  type Run,
  type RunStatus,
} from "@opencoreagents/core";

import {
  createExpressDemoLlm,
  expressLlmConfig,
  EXPRESS_TAG_CHAT,
  EXPRESS_TAG_WAIT,
} from "./llm.js";
import {
  corsMiddleware,
  optionalBearerAuth,
  requestId,
  securityHeaders,
} from "./middleware.js";
import { registerGracefulShutdown } from "./shutdown.js";
import { initSse, sendSse } from "./sse.js";

const PROJECT_ID = "express-demo";
const AGENT_CHAT = "api-chat";
const AGENT_WAIT = "api-wait-demo";

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY?.trim();

/** Process start (for `/status` `startedAt`). */
const PROCESS_STARTED_AT_MS = Date.now();

/** Last `result` step in protocol history → string for JSON `reply`. */
function resultText(run: Run): string | undefined {
  const last = run.history.filter((h) => h.type === "result").pop();
  return last && typeof last.content === "string" ? last.content : undefined;
}

/** Most recent `wait` step’s `reason` (for API clients). */
function lastWaitReason(run: Run): string | undefined {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const m = run.history[i]!;
    if (m.type !== "wait") continue;
    const c = m.content as { reason?: string };
    return typeof c.reason === "string" ? c.reason : undefined;
  }
  return undefined;
}

/** Texts from **`Agent.resume`** / in-process resume after **`wait`** (stored on **`run.state.resumeInputs`**). */
function resumeInputsFromState(run: Run): string[] | undefined {
  const ri = run.state.resumeInputs;
  return Array.isArray(ri) && ri.length > 0 ? ri : undefined;
}

/**
 * Timeline for API/UI: same as persisted **`history`**, plus one synthetic **`observation`**
 * after each **`wait`** so **`resume`** text appears between wait and **`result`** (not stored in **`RunStore`**).
 */
function historyWithResumeTimeline(run: Run): Run["history"] {
  const inputs = run.state.resumeInputs;
  const h = run.history;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return h;
  }
  const out: Run["history"] = [];
  let ri = 0;
  for (const msg of h) {
    out.push(msg);
    if (msg.type === "wait" && ri < inputs.length) {
      const text = inputs[ri++]!;
      out.push({
        type: "observation",
        content: { kind: "resume_input", text },
        meta: { ts: msg.meta.ts, source: "engine" },
      });
    }
  }
  return out;
}

/** Runs persisted in **`RunStore`** for this session (both agents — chat + wait-demo). */
async function loadRunsForSession(
  store: InMemoryRunStore,
  sessionId: string,
): Promise<Run[]> {
  const [chatRuns, waitRuns] = await Promise.all([
    store.listByAgent(AGENT_CHAT),
    store.listByAgent(AGENT_WAIT),
  ]);
  return [...chatRuns, ...waitRuns].filter((r) => r.sessionId === sessionId);
}

function emptyStatusCounts(): Record<RunStatus, number> {
  return { running: 0, waiting: 0, completed: 0, failed: 0 };
}

async function bootstrap(): Promise<void> {
  const llmCfg = expressLlmConfig();

  // Persists `waiting` runs so a later HTTP call can `resume` by `runId` (same process only).
  const runStore = new InMemoryRunStore();

  // One runtime per process — shared by all requests (typical single Node server).
  const runtime = new AgentRuntime({
    llmAdapter: createExpressDemoLlm(),
    memoryAdapter: new InMemoryMemoryAdapter(),
    runStore,
    maxIterations: 20,
  });

  // Tags in systemPrompt are read by `createExpressDemoLlm()` to route provider vs mock vs wait script.
  await Agent.define({
    id: AGENT_CHAT,
    projectId: PROJECT_ID,
    systemPrompt: [
      "You are a concise HTTP-backed assistant.",
      EXPRESS_TAG_CHAT,
    ].join(" "),
    tools: [],
    llm: { provider: llmCfg.provider, model: llmCfg.model },
  });

  await Agent.define({
    id: AGENT_WAIT,
    projectId: PROJECT_ID,
    systemPrompt: [
      "Wait/resume protocol demo for API clients.",
      EXPRESS_TAG_WAIT,
    ].join(" "),
    tools: [],
    llm: { provider: llmCfg.provider, model: llmCfg.model },
  });

  const app = express();
  app.disable("x-powered-by");
  // When behind nginx, ingress, or ALB — so `req.ip` / secure cookies behave (if you add them later).
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", (_req, res) => {
    const llm = expressLlmConfig();
    res.json({
      ok: true,
      service: "runtime-express-example",
      expressLlm: llm.backend,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      apiKeyRequired: Boolean(API_KEY),
    });
  });

  /** GET /status — liveness + process metadata (no auth; pair with `/health` for probes). */
  app.get("/status", (_req, res) => {
    res.json({
      ok: true,
      service: "runtime-express-example",
      uptimeMs: Math.round(process.uptime() * 1000),
      startedAt: new Date(PROCESS_STARTED_AT_MS).toISOString(),
      pid: process.pid,
      node: process.version,
      env: process.env.NODE_ENV ?? "development",
    });
  });

  /** Vanilla demo UI: **`GET /`** → **`public/index.html`**. */
  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: 0 }));

  const v1 = express.Router();
  v1.use(optionalBearerAuth(API_KEY));

  /**
   * GET /v1/runs/:runId?sessionId=… — load persisted run from **`RunStore`** (same **`sessionId`** as **`run`** / **`resume`**).
   * Includes **`userInput`**, **`resumeInputs`**, and **`history`** (protocol steps; resume text is inserted after each **`wait`** for display).
   */
  v1.get("/runs/:runId", async (req, res) => {
    const { runId } = req.params;
    const q = req.query.sessionId;
    const sessionId = typeof q === "string" && q.trim() ? q.trim() : "";
    if (!sessionId) {
      res.status(400).json({ error: "Query ?sessionId= is required" });
      return;
    }

    const run = await runStore.load(runId);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    if (run.sessionId != null && run.sessionId !== sessionId) {
      res.status(403).json({ error: "sessionId does not match this run" });
      return;
    }

    const userInput =
      typeof run.state.userInput === "string" ? run.state.userInput : undefined;
    const resumeInputs = resumeInputsFromState(run);

    res.json({
      runId: run.runId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      status: run.status,
      userInput,
      ...(resumeInputs ? { resumeInputs } : {}),
      reply: resultText(run),
      ...(run.status === "waiting" ? { waitReason: lastWaitReason(run) } : {}),
      iteration: run.state.iteration,
      history: historyWithResumeTimeline(run),
    });
  });

  /**
   * GET /v1/sessions/:sessionId/status — all persisted **`Run`s** for this **`Session`** (poll UX / dashboards).
   * Each run includes **`history`** (with resume steps spliced after **`wait`**) unless **`?light=1`** (omit **`history`** to save bytes).
   */
  v1.get("/sessions/:sessionId/status", async (req, res) => {
    const sessionId = req.params.sessionId?.trim() ?? "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const light =
      req.query.light === "1" ||
      req.query.light === "true" ||
      req.query.light === "yes";

    const runs = await loadRunsForSession(runStore, sessionId);
    const byStatus = emptyStatusCounts();
    for (const r of runs) {
      byStatus[r.status] += 1;
    }

    res.json({
      sessionId,
      projectId: PROJECT_ID,
      runs: runs.map((r) => {
        const userInput =
          typeof r.state.userInput === "string" ? r.state.userInput : undefined;
        const resumeInputs = resumeInputsFromState(r);
        const merged = historyWithResumeTimeline(r);
        const base = {
          runId: r.runId,
          agentId: r.agentId,
          status: r.status,
          userInput,
          ...(resumeInputs ? { resumeInputs } : {}),
          historyStepCount: merged.length,
          reply: resultText(r),
          ...(r.status === "waiting" ? { waitReason: lastWaitReason(r) } : {}),
          iteration: r.state.iteration,
        };
        return light ? base : { ...base, history: merged };
      }),
      summary: { total: runs.length, byStatus },
    });
  });

  /**
   * POST /v1/chat
   * Body: { "message": string, "sessionId"?: string }
   */
  v1.post("/chat", async (req, res) => {
    const body = req.body as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      res.status(400).json({ error: "Expected JSON body: { \"message\": string }" });
      return;
    }
    // Stable id lets the client correlate multiple turns; omit → new conversation id per request.
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID();

    try {
      const session = new Session({ id: sessionId, projectId: PROJECT_ID });
      const agent = await Agent.load(AGENT_CHAT, runtime, { session });
      // `await` blocks until the run finishes (`completed` / `failed` / `waiting`). For hook-by-hook SSE, use **`/v1/chat/stream`**.
      const run = await agent.run(body.message.trim());
      res.json({
        sessionId,
        runId: run.runId,
        status: run.status,
        reply: resultText(run),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /v1/chat/stream — same body as **`/v1/chat`**, but **`text/event-stream`** (SSE).
   * Events: **`step`** (thought / action), **`observation`**, **`done`** (final `runId`, `status`, `reply`).
   * Use **`fetch()`** + **`response.body`** or **`curl -N`**; browser **`EventSource`** is GET-only.
   */
  v1.post("/chat/stream", async (req, res) => {
    const body = req.body as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      res.status(400).json({ error: "Expected JSON body: { \"message\": string }" });
      return;
    }
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID();

    initSse(res);

    try {
      const session = new Session({ id: sessionId, projectId: PROJECT_ID });
      const agent = await Agent.load(AGENT_CHAT, runtime, { session });
      const run = await agent
        .run(body.message.trim())
        .onThought((step) => {
          sendSse(res, "step", { phase: "thought", step });
        })
        .onAction((step) => {
          sendSse(res, "step", { phase: "action", step });
        })
        .onObservation((obs) => {
          sendSse(res, "observation", { value: obs });
        });

      sendSse(res, "done", {
        sessionId,
        runId: run.runId,
        status: run.status,
        reply: resultText(run),
        ...(run.status === "waiting" ? { waitReason: lastWaitReason(run) } : {}),
      });
      res.end();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendSse(res, "error", { message: msg });
      res.end();
    }
  });

  /**
   * POST /v1/runs/wait-demo
   * Body: { "sessionId"?: string } — reuse the same sessionId for resume.
   */
  v1.post("/runs/wait-demo", async (req, res) => {
    const body = req.body as { sessionId?: unknown };
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID();

    try {
      const existing = await loadRunsForSession(runStore, sessionId);
      const waitingDemo = existing.find(
        (r) => r.agentId === AGENT_WAIT && r.status === "waiting",
      );
      if (waitingDemo) {
        res.status(409).json({
          error:
            "This session already has a waiting wait-demo run; POST /resume that run or use another session.",
          sessionId,
          runId: waitingDemo.runId,
          status: waitingDemo.status,
          waitReason: lastWaitReason(waitingDemo),
          resumeWith: {
            method: "POST",
            path: `/v1/runs/${waitingDemo.runId}/resume`,
            body: { sessionId, text: "<user name or follow-up>" },
          },
        });
        return;
      }

      const session = new Session({ id: sessionId, projectId: PROJECT_ID });
      const agent = await Agent.load(AGENT_WAIT, runtime, { session });
      const run = await agent.run("Start wait/resume demo for HTTP client.");

      // Scripted LLM returns `wait` first; run is saved to `runStore` — client must POST `/resume`.
      if (run.status === "waiting") {
        // 202 Accepted: action pending (human/agent follow-up via another request).
        res.status(202).json({
          sessionId,
          runId: run.runId,
          status: run.status,
          waitReason: lastWaitReason(run),
          resumeWith: {
            method: "POST",
            path: `/v1/runs/${run.runId}/resume`,
            body: { sessionId, text: "<user name or follow-up>" },
          },
        });
        return;
      }

      res.json({
        sessionId,
        runId: run.runId,
        status: run.status,
        reply: resultText(run),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /v1/runs/:runId/resume
   * Body: { "sessionId": string, "text": string }
   */
  v1.post("/runs/:runId/resume", async (req, res) => {
    const { runId } = req.params;
    // `sessionId` must match the Session used when the run started — engine validates the persisted run.
    const body = req.body as { sessionId?: unknown; text?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      res.status(400).json({ error: "Expected JSON body: { \"sessionId\": string, \"text\": string }" });
      return;
    }
    if (typeof body.text !== "string") {
      res.status(400).json({ error: "Expected \"text\" string in body." });
      return;
    }

    try {
      const session = new Session({
        id: body.sessionId.trim(),
        projectId: PROJECT_ID,
      });
      const agent = await Agent.load(AGENT_WAIT, runtime, { session });
      // Loads run from `runStore`, appends resume as `[resume:text] …` in the engine, continues loop.
      const run = await agent.resume(runId, {
        type: "text",
        content: body.text,
      });

      res.json({
        sessionId: body.sessionId.trim(),
        runId: run.runId,
        status: run.status,
        reply: resultText(run),
      });
    } catch (e) {
      // Stale `runId`, wrong session, or run not `waiting` → engine throws; surface as 400.
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  });

  app.use("/v1", v1);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Express 4 error handler (needs 4 args). Nothing in this file calls `next(err)`; routes use try/catch.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    },
  );

  const server: Server = app.listen(PORT, () => {
    const llm = expressLlmConfig();
    const chatLabel =
      llm.backend === "openai"
        ? "OpenAI"
        : llm.backend === "anthropic"
          ? "Anthropic"
          : "mock";
    console.log(
      `Express + runtime on http://127.0.0.1:${PORT} (UI: http://127.0.0.1:${PORT}/) | chat: ${chatLabel} (${llm.provider}/${llm.model}) | API_KEY ${API_KEY ? "required for /v1" : "not set (open /v1)"}`,
    );
  });

  const shutdownMs = Number(process.env.SHUTDOWN_TIMEOUT_MS);
  registerGracefulShutdown(server, {
    timeoutMs: Number.isFinite(shutdownMs) && shutdownMs > 0 ? shutdownMs : undefined,
  });
}

// Top-level await alternative: keep startup failures visible with non-zero exit.
void bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
