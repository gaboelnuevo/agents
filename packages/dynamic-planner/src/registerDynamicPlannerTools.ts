import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import {
  Tool,
  type AgentDefinitionPersisted,
  type EngineRunJobPayload,
  type Run,
  type RunStore,
  type ToolContext,
} from "@opencoreagents/core";
import { DEFAULT_BUILTIN_TOOLS_FOR_LISTING } from "./builtinToolsSummary.js";
import {
  DEFAULT_MODEL_SELECTION_GUIDE,
  filterPlannerModelsByProvider,
} from "./modelCatalog.js";

export type PlannerEnqueueRun = (
  payload: Omit<EngineRunJobPayload, "kind">,
  opts?: PlannerEnqueueOptions,
) => Promise<{ id?: string }>;

export interface ResolveAvailableModelsArgs {
  provider?: string;
  ctx: ToolContext;
}

export type ResolveAvailableModels = (
  args: ResolveAvailableModelsArgs,
) => Promise<readonly import("./modelCatalog.js").PlannerModelEntry[]>;

/** Subset of BullMQ {@link JobsOptions} commonly used for sub-agent jobs. */
export interface PlannerEnqueueOptions {
  priority?: number;
  attempts?: number;
  backoff?: { type: "exponential" | "fixed"; delay: number };
}

export interface DynamicPlannerToolsConfig {
  /** Redis (or in-memory) definitions store — sub-agent rows are written with {@link DynamicDefinitionsStore.Agent.define}. */
  definitionsStore: DynamicDefinitionsStore;
  /** For {@link waitForAgentsTool} polling. */
  runStore: RunStore;
  /** Enqueue engine run jobs (e.g. {@link createEngineQueue} `.addRun`). */
  enqueueRun: PlannerEnqueueRun;
  /** Used when a sub-agent omits `llm` in `spawn_agent`. */
  defaultSubAgentLlm: { provider: string; model: string; temperature?: number };
  /** Max nesting depth for `spawn_agent` (0 = planner only). Default 2. */
  maxPlannerDepth?: number;
  /** Blocklisted tool ids for sub-agents (always merged with built-in planner tools). */
  forbiddenToolsForSubAgents?: readonly string[];
  /** Optional model catalog override for `list_available_models`. */
  modelCatalog?: readonly import("./modelCatalog.js").PlannerModelEntry[];
  /**
   * Optional runtime resolver for `list_available_models`.
   * Use this when your deployment can discover models from a proxy/custom endpoint instead of
   * returning a static catalog baked into the package.
   */
  resolveAvailableModels?: ResolveAvailableModels;
  /** Optional selection guide override. */
  modelSelectionGuide?: Readonly<Record<string, string>>;
  /**
   * When set, throw if active+waiting jobs exceed this threshold before enqueueing a sub-agent.
   * Wire to `queue.getJobCounts('active','waiting')` in your app.
   */
  getQueuedJobCounts?: () => Promise<{ active: number; waiting: number }>;
  maxConcurrentQueuedJobs?: number;
  /**
   * Called after each successful `spawn_agent` (definition written + job enqueued).
   * Use to record ephemeral `spawnedAgentId` / `spawnedRunId` for your own cleanup or metrics
   * (the engine does not persist the parent run to {@link RunStore} until the planner job finishes,
   * so you cannot rely on mutating the parent run mid-flight).
   */
  onEphemeralSubAgentSpawned?: (info: {
    projectId: string;
    plannerRunId: string;
    plannerSessionId: string;
    plannerAgentId: string;
    spawnedAgentId: string;
    spawnedRunId: string;
  }) => Promise<void>;
}

const DEFAULT_FORBIDDEN = [
  "spawn_agent",
  "wait_for_agents",
  "reflect_and_retry",
  "list_available_tools",
  "list_available_models",
  /** Delegation to the planner from non-planner agents — not for spawned sub-agents (runtime `invokePlannerTool.ts`). */
  "invoke_planner",
  /** Runtime chat helper — not for planner sub-agents (`fetchRunTool.ts`). */
  "runtime_fetch_run",
] as const;

function getPlannerDepth(sessionContext: Readonly<Record<string, unknown>> | undefined): number {
  const v = sessionContext?.plannerDepth;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function mergeSessionContext(
  ctx: ToolContext,
  plannerDepth: number,
): Record<string, unknown> {
  const prev = ctx.sessionContext;
  const base =
    prev != null && typeof prev === "object" && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  base.plannerDepth = plannerDepth;
  return base;
}

function resultTextFromRun(run: Run): string {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const h = run.history[i]!;
    if (h.type === "result" && typeof h.content === "string") return h.content;
  }
  return "";
}

function failureSummary(run: Run): string {
  const last = run.history[run.history.length - 1];
  if (
    last?.type === "observation" &&
    last.content &&
    typeof last.content === "object" &&
    !Array.isArray(last.content)
  ) {
    const o = last.content as { error?: string };
    if (typeof o.error === "string" && o.error.trim()) return o.error;
  }
  return "run failed";
}

function asRecord(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/**
 * Registers global tools: `spawn_agent`, `wait_for_agents`, `reflect_and_retry`,
 * `list_available_tools`, `list_available_models`.
 *
 * Call once per process at startup (same as other {@link Tool.define} registrations).
 */
export async function registerDynamicPlannerTools(
  config: DynamicPlannerToolsConfig,
): Promise<void> {
  const maxDepth = config.maxPlannerDepth ?? 2;
  const forbidden = new Set<string>([
    ...DEFAULT_FORBIDDEN,
    ...(config.forbiddenToolsForSubAgents ?? []),
  ]);
  const catalog = config.modelCatalog ?? [];
  const selectionGuide = config.modelSelectionGuide ?? DEFAULT_MODEL_SELECTION_GUIDE;

  await Tool.define({
    id: "spawn_agent",
    scope: "global",
    description:
      "Creates a **temporary** sub-agent for this plan: writes a project-scoped agent definition " +
      "(same agentId on a later call overwrites that row) and enqueues a background run. " +
      "You do not pre-create these agents in the catalog — pick a **unique agentId per subtask** " +
      "(e.g. include the planner run id or a random suffix). " +
      "Returns jobId and runId for wait_for_agents. " +
      "NEVER include spawn_agent in the sub-agent's tool list.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "Unique id for this **ephemeral** sub-agent (snake_case). Reusing an id replaces the Redis row; " +
            "suffix with planner context or time to avoid clashes across plans.",
        },
        systemPrompt: {
          type: "string",
          description: "Full, specific instructions for the sub-agent.",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool ids for this sub-agent. Must exist in the registry.",
        },
        input: {
          type: "string",
          description: "First task/message for the sub-agent.",
        },
        llm: {
          type: "object",
          description: "Optional provider/model override (see list_available_models).",
          properties: {
            provider: { type: "string" },
            model: { type: "string" },
            temperature: { type: "number" },
          },
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Queue priority.",
          default: "normal",
        },
      },
      required: ["agentId", "systemPrompt", "tools", "input"],
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      const agentId = String(args.agentId ?? "");
      const systemPrompt = String(args.systemPrompt ?? "");
      const tools = Array.isArray(args.tools) ? args.tools.map((t) => String(t)) : [];
      const userInput = String(args.input ?? "");
      const priority = (args.priority as string | undefined) ?? "normal";
      const llmArg = args.llm;

      if (!agentId.trim()) throw new Error("spawn_agent: agentId is required");
      if (!systemPrompt.trim()) throw new Error("spawn_agent: systemPrompt is required");
      if (!userInput.trim()) throw new Error("spawn_agent: input is required");

      const depth = getPlannerDepth(ctx.sessionContext);
      if (depth >= maxDepth) {
        throw new Error(
          `plannerDepth ${depth} exceeds limit of ${maxDepth}. Sub-agents cannot create more agents.`,
        );
      }

      const bad = tools.filter((t) => forbidden.has(t));
      if (bad.length > 0) {
        throw new Error(`Tools not allowed for sub-agents: ${bad.join(", ")}`);
      }

      if (config.getQueuedJobCounts && config.maxConcurrentQueuedJobs != null) {
        const counts = await config.getQueuedJobCounts();
        const n = counts.active + counts.waiting;
        if (n >= config.maxConcurrentQueuedJobs) {
          throw new Error(
            `Limit of ${config.maxConcurrentQueuedJobs} active sub-agent jobs reached. Wait for some to finish.`,
          );
        }
      }

      const projectId = ctx.projectId;
      const runId = `run-${agentId}-${Date.now()}`;
      const sessionId = `spawned-${agentId}-${Date.now()}`;

      const llm =
        llmArg != null && typeof llmArg === "object" && !Array.isArray(llmArg)
          ? (llmArg as Record<string, unknown>)
          : null;
      const provider = typeof llm?.provider === "string" ? llm.provider : undefined;
      const model = typeof llm?.model === "string" ? llm.model : undefined;
      const temperature = typeof llm?.temperature === "number" ? llm.temperature : undefined;

      const subLlm =
        provider && model
          ? temperature !== undefined
            ? { provider, model, temperature }
            : { provider, model }
          : config.defaultSubAgentLlm;

      const agentRow: AgentDefinitionPersisted = {
        id: agentId,
        projectId,
        systemPrompt,
        tools,
        llm: subLlm,
      };

      await config.definitionsStore.Agent.define(agentRow);

      const job = await config.enqueueRun(
        {
          projectId,
          agentId,
          sessionId,
          runId,
          userInput,
          endUserId: ctx.endUserId,
          sessionContext: mergeSessionContext(ctx, depth + 1),
          fileReadRoot: ctx.fileReadRoot,
          allowFileReadOutsideRoot: ctx.allowFileReadOutsideRoot,
          allowHttpFileSources: ctx.allowHttpFileSources,
          httpFileSourceHostsAllowlist: ctx.httpFileSourceHostsAllowlist,
        },
        {
          priority: priority === "high" ? 1 : priority === "low" ? 10 : 5,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      );

      await config.onEphemeralSubAgentSpawned?.({
        projectId,
        plannerRunId: ctx.runId,
        plannerSessionId: ctx.sessionId,
        plannerAgentId: ctx.agentId,
        spawnedAgentId: agentId,
        spawnedRunId: runId,
      });

      return {
        jobId: job.id ?? "",
        runId,
        sessionId,
        agentId,
        status: "queued",
      };
    },
  });

  await Tool.define({
    id: "wait_for_agents",
    scope: "global",
    description:
      "Waits for sub-agents started with spawn_agent to finish. " +
      "Returns results for completed runs and errors for failed ones. " +
      "Call after all spawn_agent calls in the same step.",
    inputSchema: {
      type: "object",
      properties: {
        runIds: {
          type: "array",
          items: { type: "string" },
          description: "runIds to wait for (from spawn_agent).",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in ms per agent. Default: 120000 (2 min).",
          default: 120_000,
        },
        failOnAny: {
          type: "boolean",
          description: "If true, fail as soon as any sub-agent fails. Default: false.",
          default: false,
        },
      },
      required: ["runIds"],
    },
    execute: async (input) => {
      const args = asRecord(input);
      const runIds = Array.isArray(args.runIds) ? args.runIds.map((x) => String(x)) : [];
      const timeoutMs =
        typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
          ? args.timeoutMs
          : 120_000;
      const failOnAny = Boolean(args.failOnAny);

      const results: Record<string, string> = {};
      const errors: Record<string, string> = {};
      const timingsMs: Record<string, number> = {};

      await Promise.allSettled(
        runIds.map(async (runId) => {
          const start = Date.now();
          const deadline = start + timeoutMs;

          while (Date.now() < deadline) {
            const run = await config.runStore.load(runId);

            if (!run) {
              const delay = 500;
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            if (run.status === "completed") {
              results[runId] = resultTextFromRun(run);
              timingsMs[runId] = Date.now() - start;
              return;
            }

            if (run.status === "failed") {
              errors[runId] = failureSummary(run);
              if (failOnAny) throw new Error(`Sub-agent ${runId} failed: ${errors[runId]}`);
              return;
            }

            const elapsed = Date.now() - start;
            const delay = elapsed < 10_000 ? 1000 : elapsed < 60_000 ? 3000 : 5000;
            await new Promise((r) => setTimeout(r, delay));
          }

          errors[runId] = `timeout after ${timeoutMs}ms`;
          if (failOnAny) throw new Error(`Sub-agent ${runId}: ${errors[runId]}`);
        }),
      );

      return {
        results,
        errors,
        completed: Object.keys(results).length,
        failed: Object.keys(errors).length,
        timingsMs,
        allCompleted: Object.keys(errors).length === 0,
      };
    },
  });

  await Tool.define({
    id: "reflect_and_retry",
    scope: "global",
    description:
      "Re-runs a sub-agent with corrective instructions when the Planner decides the output is insufficient. " +
      "Call only when you want a retry (max retries enforced).",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Sub-agent agentId to re-run" },
        result: { type: "string", description: "Sub-agent output being evaluated" },
        criteria: { type: "string", description: "What makes the output acceptable" },
        correction: { type: "string", description: "Corrective instruction" },
        retryCount: { type: "number", description: "Current retry count (0 = first retry request)", default: 0 },
        maxRetries: { type: "number", default: 2 },
      },
      required: ["agentId", "result", "criteria", "correction"],
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      const agentId = String(args.agentId ?? "");
      const result = String(args.result ?? "");
      const criteria = String(args.criteria ?? "");
      const correction = String(args.correction ?? "");
      const retryCount =
        typeof args.retryCount === "number" && Number.isFinite(args.retryCount) ? args.retryCount : 0;
      const maxRetries =
        typeof args.maxRetries === "number" && Number.isFinite(args.maxRetries) ? args.maxRetries : 2;

      if (!agentId.trim()) throw new Error("reflect_and_retry: agentId is required");

      if (retryCount >= maxRetries) {
        return {
          accepted: false,
          reason: `max retries (${maxRetries}) reached`,
          lastResult: result,
        };
      }

      const projectId = ctx.projectId;
      const sessionId = `retry-${agentId}-${Date.now()}`;
      const runId = `run-retry-${agentId}-${Date.now()}`;

      const job = await config.enqueueRun({
        projectId,
        agentId,
        sessionId,
        runId,
        userInput: `RETRY ${retryCount + 1}/${maxRetries}.\n\nIssue with previous answer: ${correction}\n\nSuccess criteria: ${criteria}\n\nTry again.`,
        endUserId: ctx.endUserId,
        sessionContext: mergeSessionContext(ctx, getPlannerDepth(ctx.sessionContext)),
        fileReadRoot: ctx.fileReadRoot,
        allowFileReadOutsideRoot: ctx.allowFileReadOutsideRoot,
        allowHttpFileSources: ctx.allowHttpFileSources,
        httpFileSourceHostsAllowlist: ctx.httpFileSourceHostsAllowlist,
      });

      return {
        accepted: false,
        retrying: true,
        jobId: job.id ?? "",
        runId,
        retryCount: retryCount + 1,
      };
    },
  });

  await Tool.define({
    id: "list_available_tools",
    scope: "global",
    description:
      "Lists tools available in the registry for this project. Call before spawn_agent to choose tool sets.",
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async (_input, ctx) => {
      const snapshot = await config.definitionsStore.methods.getSnapshot(ctx.projectId);
      const httpTools = snapshot.httpTools.map((t) => ({
        id: t.id,
        description: t.description ?? "",
        type: "http" as const,
      }));
      const builtins = [...DEFAULT_BUILTIN_TOOLS_FOR_LISTING];
      return { httpTools, builtins, total: httpTools.length + builtins.length };
    },
  });

  await Tool.define({
    id: "list_available_models",
    scope: "global",
    description:
      "Lists available LLM models with provider, relative cost, and capabilities. " +
      "**Optional** — call only when you need explicit llm overrides on spawn_agent; omit when stack defaults suffice (fewer turns, fewer parse errors on small models).",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description:
            "Optional provider filter. Use `all` or omit to return every configured/discovered model. " +
            "Custom provider ids are allowed.",
          default: "all",
        },
      },
      required: [],
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      const raw = args.provider;
      const provider = typeof raw === "string" && raw.trim() ? raw.trim() : "all";
      const available = config.resolveAvailableModels
        ? await config.resolveAvailableModels({ provider, ctx })
        : catalog;
      const filtered = filterPlannerModelsByProvider(available, provider);
      const configuredProviders = Array.from(
        new Set([
          config.defaultSubAgentLlm.provider,
          ...available.map((m) => m.provider),
        ]),
      );
      return {
        models: filtered,
        total: filtered.length,
        configuredProviders,
        defaultSubAgentLlm: config.defaultSubAgentLlm,
        selectionGuide,
        roles:
          filtered.length > 0
            ? Object.fromEntries(
                filtered.map((model) => [
                  `${model.provider}:${model.model}`,
                  [...(model.sourceRoles ?? [])],
                ]),
              )
            : {},
        note:
          filtered.length > 0
            ? "Prefer the cheapest model that is sufficient. Omit llm on spawn_agent when the runtime default is enough. Use sourceRoles to see which runtime role configured each model."
            : "No explicit model catalog is registered for this deployment. Omit llm on spawn_agent to use the runtime default, or pass an exact provider/model supported by your configured adapters.",
      };
    },
  });
}
