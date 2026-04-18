import { randomUUID } from "node:crypto";
import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import {
  Tool,
  createRun,
  type EngineRunJobPayload,
  type Run,
  type RunStore,
} from "@opencoreagents/core";
import type { PlannerEnqueueOptions, PlannerEnqueueRun } from "@opencoreagents/dynamic-planner";
import { ensurePlannerAgentExistsForInvoke } from "./runtimePlanner.js";
import type { ResolvedRuntimeStackConfig } from "../config/types.js";

function asRecord(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** Global tool id — add to an agent's `tools` in `/v1` when you want that agent to delegate to the planner. */
export const RUNTIME_INVOKE_PLANNER_TOOL_ID = "invoke_planner" as const;

/** Default cap on **invoke_planner** actions already recorded on the **caller** run (`ctx.runId`) before refusing another enqueue. */
export const RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN_DEFAULT = 5;

/**
 * Prefer `RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN`; `RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN`
 * is a legacy alias (same semantics).
 */
function resolvedMaxInvokePlannerPerCallerRun(): number {
  const preferred = process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN?.trim();
  const legacy = process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN?.trim();
  const raw =
    preferred !== undefined && preferred !== ""
      ? preferred
      : legacy !== undefined && legacy !== ""
        ? legacy
        : undefined;
  if (raw === undefined || raw === "") return RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN_DEFAULT;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

/**
 * Count completed **invoke_planner** tool steps in **`run.history`** (the current action is not appended yet).
 * Relies on the engine shape **`{ type: "action", content: { tool: string, … } }`** — keep in sync with core history records.
 */
export function countInvokePlannerActionsInRun(run: Run | null | undefined): number {
  if (!run?.history?.length) return 0;
  let n = 0;
  for (const m of run.history) {
    if (m.type !== "action") continue;
    const c = m.content as { tool?: unknown };
    if (typeof c?.tool === "string" && c.tool === RUNTIME_INVOKE_PLANNER_TOOL_ID) n++;
  }
  return n;
}

/**
 * Registers **`invoke_planner`**: enqueue a background run for the stack's dynamic planner agent
 * (same queue path as {@link registerRuntimeDynamicPlanner} / `spawn_agent`).
 *
 * Call on **server** and **worker** after {@link registerRuntimeDynamicPlanner} so validation and execution match.
 */
export async function registerRuntimeInvokePlannerTool(options: {
  definitionsStore: DynamicDefinitionsStore;
  config: ResolvedRuntimeStackConfig;
  runStore: RunStore;
  enqueueRun: PlannerEnqueueRun;
  /** Usually `config.planner.defaultAgent.id` (default `planner`). */
  defaultPlannerAgentId: string;
}): Promise<void> {
  const defaultId = options.defaultPlannerAgentId.trim() || "planner";

  await Tool.define({
    id: RUNTIME_INVOKE_PLANNER_TOOL_ID,
    scope: "global",
    description:
      "Enqueue a **background** run for the dynamic **planner** agent (it will decompose the goal with spawn_agent / wait_for_agents). " +
      "If the **default** planner agent row is missing for this project, it is **created** automatically (same as boot seed), unless auto-seed is disabled in stack/env. " +
      "Returns `jobId` and `runId` **without waiting** — this tool does not block on the planner. " +
      "A **running** placeholder row is written to **RunStore** immediately so **runtime_fetch_run** / **GET /runs/:runId** see the id (same shape the worker will overwrite when the job starts). " +
      "Optional: call **wait_for_agents** with that `runId` in a **later** tool step if you intentionally want this run to wait (that will block until done or timeout). " +
      "For **POST /v1/chat**, the default agent uses **runtime_fetch_run** on follow-up turns to read that `runId` from the server (no SSE required). " +
      "Alternatively poll **GET /runs/:runId** from the client. " +
      "**Do not call this tool multiple times in one model turn** for the same retry — one enqueue per user goal; then **runtime_fetch_run** that `runId` if you need status. Spamming **invoke_planner** burns the chat run’s max-iteration budget. " +
      "The runtime **refuses** further enqueues after **`RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN`** (default 5; legacy alias **`RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN`**) completed **invoke_planner** actions on the **caller** run. " +
      "Do not use from a run that is already the target planner agent — use **spawn_agent** for subtasks instead.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "High-level task or question for the planner.",
        },
        input: {
          type: "string",
          description: "Alias for `goal` (same semantics).",
        },
        plannerAgentId: {
          type: "string",
          description: `Planner agent id (default: \`${defaultId}\` from stack planner.defaultAgent.id).`,
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Queue priority.",
          default: "normal",
        },
      },
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      const goalRaw = args.goal ?? args.input;
      const goal = String(goalRaw ?? "");
      if (!goal.trim()) {
        throw new Error("invoke_planner: `goal` or `input` is required");
      }

      const plannerAgentIdArg = args.plannerAgentId;
      const plannerAgentId =
        typeof plannerAgentIdArg === "string" && plannerAgentIdArg.trim()
          ? plannerAgentIdArg.trim()
          : defaultId;

      if (!plannerAgentId) {
        throw new Error("invoke_planner: plannerAgentId resolved empty");
      }

      if (ctx.agentId === plannerAgentId) {
        throw new Error(
          "invoke_planner: cannot enqueue the planner agent from its own run; use spawn_agent for subtasks",
        );
      }

      const maxPer = resolvedMaxInvokePlannerPerCallerRun();
      const callerRun = await options.runStore.load(ctx.runId);
      // Missing row ⇒ 0 prior invokes (tests / rare races). Anti-spam cap still applies once history exists.
      const priorInvokes = countInvokePlannerActionsInRun(callerRun ?? undefined);
      if (priorInvokes >= maxPer) {
        return {
          rejected: true as const,
          reason: "max_invoke_planner_per_caller_run",
          limit: maxPer,
          priorInvocations: priorInvokes,
          hint:
            "This engine run already invoked invoke_planner enough times. Use runtime_fetch_run on an existing planner runId, then return a result step.",
        };
      }

      await ensurePlannerAgentExistsForInvoke({
        store: options.definitionsStore,
        projectId: ctx.projectId,
        config: options.config,
        targetPlannerAgentId: plannerAgentId,
      });

      const runId = `run-invoke-planner-${randomUUID()}`;
      const sessionId = `planner-invoke-${randomUUID()}`;
      const priority = (args.priority as string | undefined) ?? "normal";

      const payload: Omit<EngineRunJobPayload, "kind"> = {
        projectId: ctx.projectId,
        agentId: plannerAgentId,
        sessionId,
        runId,
        userInput: goal,
        endUserId: ctx.endUserId,
        sessionContext: {
          invokedByAgentId: ctx.agentId,
          invokedByRunId: ctx.runId,
          invokedBySessionId: ctx.sessionId,
        },
        fileReadRoot: ctx.fileReadRoot,
        allowFileReadOutsideRoot: ctx.allowFileReadOutsideRoot,
        allowHttpFileSources: ctx.allowHttpFileSources,
        httpFileSourceHostsAllowlist: ctx.httpFileSourceHostsAllowlist,
      };

      const opts: PlannerEnqueueOptions = {
        priority: priority === "high" ? 1 : priority === "low" ? 10 : 5,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      };

      const stub = createRun(plannerAgentId, sessionId, goal, ctx.projectId, runId);
      await options.runStore.save(stub);
      try {
        const job = await options.enqueueRun(payload, opts);
        return {
          jobId: job.id ?? "",
          runId,
          sessionId,
          plannerAgentId,
          status: "queued" as const,
        };
      } catch (e) {
        await options.runStore.delete(runId).catch(() => {});
        throw e;
      }
    },
  });
}
