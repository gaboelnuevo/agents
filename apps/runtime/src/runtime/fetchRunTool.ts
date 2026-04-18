import type { Run, RunStore } from "@opencoreagents/core";
import { Tool } from "@opencoreagents/core";
import { summarizeEngineRun } from "@opencoreagents/rest-api";
import { RUNTIME_INVOKE_PLANNER_TOOL_ID } from "./invokePlannerTool.js";

function asRecord(input: unknown): Record<string, unknown> {
  return input != null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/**
 * One short, neutral English line for the chat model to echo when the user only asked for **status**
 * (avoids treating **failed** as “you failed” instead of “this run’s persisted state”).
 */
function buildStatusSummaryForChat(input: {
  status: Run["status"];
  historyStepCount: number;
  failedReason: string | undefined;
  reply: string | undefined;
}): string {
  const n = input.historyStepCount;
  switch (input.status) {
    case "running":
      return `Status: **running**. History: ${n} step(s). Still executing (or starting).`;
    case "waiting":
      return `Status: **waiting**. History: ${n} step(s). Engine is waiting (e.g. pause / wait step).`;
    case "completed": {
      const hasReply = Boolean(input.reply?.trim());
      return `Status: **completed**. History: ${n} step(s).${hasReply ? " **reply** has the final output." : ""}`;
    }
    case "failed": {
      const fr = input.failedReason?.trim() || "(no detail)";
      return (
        `Status: **failed**. History: ${n} step(s). Reason: ${fr}. ` +
        `This is the persisted run state on the server; for a status-only question, answer with facts and do not catastrophize. **hint** (if present) is optional technical context.`
      );
    }
    default:
      return `Status: **${String(input.status)}**. History: ${n} step(s).`;
  }
}

/**
 * Latest **`run-invoke-planner-…`** id from **`invoke_planner`** tool pairs in this run’s **`history`**
 * (same order as {@link Run.history} — last enqueue wins).
 */
export function lastInvokePlannerRunIdFromCallerHistory(history: Run["history"] | undefined): string | undefined {
  if (!history?.length) return undefined;
  let last: string | undefined;
  for (let i = 0; i + 1 < history.length; i++) {
    const a = history[i];
    const b = history[i + 1];
    if (a.type !== "action" || b.type !== "observation") continue;
    const ac = a.content as { tool?: unknown };
    if (typeof ac?.tool !== "string" || ac.tool !== RUNTIME_INVOKE_PLANNER_TOOL_ID) continue;
    const rid = asRecord(b.content).runId;
    if (typeof rid !== "string") continue;
    const t = rid.trim();
    if (t.startsWith("run-invoke-planner-")) last = t;
  }
  return last;
}

function earlyParseFailureHint(failedReason: string | undefined, historyLen: number): string | undefined {
  if (!failedReason || historyLen > 0) return undefined;
  const fr = failedReason.toLowerCase();
  if (
    fr.includes("step_schema") ||
    fr.includes("parse recovery") ||
    fr.includes("invalid json") ||
    fr.includes("parse_failed")
  ) {
    return (
      "This run never recorded a valid engine step: LLM output was not parseable protocol JSON. " +
      "Typical with local/OpenAI-compatible servers that ignore JSON mode. " +
      "Raise RUNTIME_ENGINE_MAX_PARSE_RECOVERY, or use a model for that agent that follows json_object (check the agent row in definitions / Redis), or a hosted endpoint that honors JSON mode."
    );
  }
  return undefined;
}

/**
 * Global tool id for {@link registerRuntimeFetchRunTool}.
 *
 * **Execute path:** one or two **`RunStore.load`** calls (second only when **`runId`** is omitted and the
 * caller run’s history is scanned) — always non-blocking; it never waits for the target run’s
 * worker/LLM loop to finish. **Model policy:** when **status** is **running** or **waiting**, answer and **`result`**
 * in the same turn; do not spin tools until that run reaches **completed** unless the user asks again.
 */
export const RUNTIME_FETCH_RUN_TOOL_ID = "runtime_fetch_run" as const;

/**
 * Registers **`runtime_fetch_run`**: read **`status`** / **`reply`** for any persisted **`runId`**
 * (e.g. planner) from {@link RunStore} — no SSE required.
 */
export async function registerRuntimeFetchRunTool(options: { runStore: RunStore }): Promise<void> {
  await Tool.define({
    id: RUNTIME_FETCH_RUN_TOOL_ID,
    scope: "global",
    description:
      "Read-only **RunStore** lookup by **`runId`** (same **`projectId`**). Returns immediately — does **not** wait for the target run’s background job to finish. " +
      "**`ok: true`** means the row was **found** (lookup succeeded), **not** that the target run **`status`** is **`completed`** — always read **`status`** / **`statusSummary`** next. " +
      "**`runId`** may be **omitted** on the **caller** run (e.g. chat): the server uses the **last** **`invoke_planner`** observation’s **`runId`** from **`RunStore.load(ctx.runId)`** history. Otherwise pass **`runId`** explicitly. " +
      "Use on a **later turn** after **`invoke_planner`** returned a **`runId`**: **`status`**, **`statusSummary`** (neutral English one-liner — prefer this when the user only asked for status), **`reply`**, **`historyStepCount`**, **`failedReason`** when **`failed`**, optional **`hint`**. " +
      "When **`status`** is **running** or **waiting**, that is a complete answer for status/progress: tell the user and end with a **`result`** step now — **do not** keep calling tools (or **`invoke_planner`** again) until that run becomes **`completed`** unless the user explicitly asks for another check. " +
      "If **`historyStepCount`** is **0** and **`failedReason`** mentions parse / step schema, the planner LLM never emitted valid protocol JSON (common with local endpoints); the response may include a **`hint`** for operators. " +
      "You may suggest the user sends another message later to refresh **`reply`** once **`completed`**.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description:
            "Engine **`runId`** to fetch (e.g. **`run-invoke-planner-…`**). **Omit** (or empty) on the **same** caller run to reuse the **latest** **`invoke_planner`** **`runId`** from persisted **`history`**. Snapshot only — this call does not block until that run finishes.",
        },
      },
    },
    execute: async (input, ctx) => {
      const args = asRecord(input);
      let runId = String(args.runId ?? "").trim();
      if (!runId) {
        const caller = await options.runStore.load(ctx.runId);
        runId = lastInvokePlannerRunIdFromCallerHistory(caller?.history) ?? "";
        if (!runId) {
          throw new Error(
            "runtime_fetch_run: pass runId, or omit it only after invoke_planner on this run (no planner runId found in caller history)",
          );
        }
      }

      const run = await options.runStore.load(runId);
      if (!run) {
        return { ok: false as const, runId, error: "run not found" };
      }

      if (run.projectId != null && run.projectId !== "" && run.projectId !== ctx.projectId) {
        return { ok: false as const, runId, error: "run belongs to a different project" };
      }

      const summary = summarizeEngineRun(run);
      const hint = earlyParseFailureHint(summary.failedReason, run.history.length);
      const statusSummary = buildStatusSummaryForChat({
        status: summary.status,
        historyStepCount: run.history.length,
        failedReason: summary.failedReason,
        reply: summary.reply,
      });
      // Put outcome fields before long ids so truncated tool logs still show status / failure.
      return {
        ok: true as const,
        runId: run.runId,
        status: summary.status,
        statusSummary,
        ...(summary.failedReason !== undefined ? { failedReason: summary.failedReason } : {}),
        historyStepCount: run.history.length,
        reply: summary.reply,
        ...(hint !== undefined ? { hint } : {}),
        agentId: run.agentId,
        sessionId: run.sessionId,
      };
    },
  });
}
