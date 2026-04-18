import type { Run, RunStore } from "@opencoreagents/core";
import { Tool } from "@opencoreagents/core";
import { summarizeEngineRun } from "@opencoreagents/rest-api";

function asRecord(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** Global tool — read a persisted run (e.g. after **`invoke_planner`**) from the same project. */
export const RUNTIME_FETCH_RUN_TOOL_ID = "runtime_fetch_run" as const;

/**
 * Lets the **chat** agent pull **`status`** / **`reply`** for a **`runId`** (planner or other) from
 * {@link RunStore} so follow-up turns can answer without SSE or a separate HTTP client.
 */
export async function registerRuntimeFetchRunTool(options: { runStore: RunStore }): Promise<void> {
  await Tool.define({
    id: RUNTIME_FETCH_RUN_TOOL_ID,
    scope: "global",
    description:
      "Read a persisted engine **run** by **`runId`** (same **`projectId`** as the caller). " +
      "Use on a **later chat turn** after **`invoke_planner`** returned a **`runId`**: returns **`status`**, **`reply`** (last protocol result text), **`historyStepCount`**, and **`failedReason`** when the run ended in **`failed`**. " +
      "If the run is still **running** or **waiting**, say so and suggest the user wait or call this tool again.",
    inputSchema: {
      type: "object",
      required: ["runId"],
      properties: {
        runId: {
          type: "string",
          description: "Engine run id, e.g. `run-invoke-planner-…` from `invoke_planner`.",
        },
      },
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      const runId = String(args.runId ?? "").trim();
      if (!runId) {
        throw new Error("runtime_fetch_run: runId is required");
      }

      const run = await options.runStore.load(runId);
      if (!run) {
        return { ok: false as const, runId, error: "run not found" };
      }

      if (run.projectId != null && run.projectId !== "" && run.projectId !== ctx.projectId) {
        return { ok: false as const, runId, error: "run belongs to a different project" };
      }

      const summary = summarizeEngineRun(run);
      return {
        ok: true as const,
        runId: run.runId,
        agentId: run.agentId,
        sessionId: run.sessionId,
        status: summary.status,
        reply: summary.reply,
        ...(summary.failedReason !== undefined ? { failedReason: summary.failedReason } : {}),
        historyStepCount: run.history.length,
      };
    },
  });
}
