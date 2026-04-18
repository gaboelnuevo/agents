import type { Run } from "@opencoreagents/core";

/** Compact summary of a **`Run`** for job payloads, tools, and HTTP JSON. */
export interface EngineRunSummary {
  status: Run["status"];
  runId: string;
  /** Last **`result`** step **`content`** in **`run.history`**, if any. */
  reply: string | undefined;
  /**
   * Copy of **`run.state.failedReason`** when set (trimmed), else **`undefined`**.
   * Always present on the object so callers can read **`summary.failedReason`** without optional chaining quirks.
   */
  failedReason: string | undefined;
}

/**
 * Narrow full **`Run`** history for job **`returnvalue`** and HTTP responses.
 *
 * **`reply`** is the **`content`** of the **last** protocol step with **`type: "result"`** in
 * **`run.history`**. Each completed LLM turn that ends with a `result` step appends one such entry;
 * **`Agent.continueRun`** keeps the same **`runId`** and appends further steps, so the last `result`
 * is normally the assistant text for the latest user turn. If you need a stable view after a queued
 * job finishes, prefer loading the run from **`RunStore`** (authoritative after the worker persists)
 * before calling this helper.
 *
 * **`failedReason`** is taken from **`run.state.failedReason`** (typically when **`status`** is **`failed`**).
 * A **`failed`** run may still have a **`reply`** if the history contains an earlier **`result`** before failure.
 */
export function summarizeEngineRun(run: Run): EngineRunSummary {
  const result = run.history.filter((h) => h.type === "result").pop();
  const failedReason =
    typeof run.state.failedReason === "string" && run.state.failedReason.trim()
      ? run.state.failedReason.trim()
      : undefined;
  return {
    status: run.status,
    runId: run.runId,
    reply: result && typeof result.content === "string" ? result.content : undefined,
    failedReason,
  };
}

/** Compact row for **`GET /agents/:agentId/runs`** (dashboards — not full step log). */
export interface RuntimeRestRunListItem {
  runId: string;
  agentId: string;
  sessionId?: string;
  projectId?: string;
  status: Run["status"];
  iteration: number;
  historyStepCount: number;
  userInput?: string;
  reply?: string;
  failedReason?: string;
}

export function summarizeRunListEntry(run: Run): RuntimeRestRunListItem {
  const { reply, failedReason } = summarizeEngineRun(run);
  const userInput =
    typeof run.state.userInput === "string" ? run.state.userInput : undefined;
  const row: RuntimeRestRunListItem = {
    runId: run.runId,
    agentId: run.agentId,
    status: run.status,
    iteration: run.state.iteration,
    historyStepCount: run.history.length,
  };
  if (run.sessionId !== undefined) row.sessionId = run.sessionId;
  if (run.projectId !== undefined) row.projectId = run.projectId;
  if (userInput !== undefined) row.userInput = userInput;
  if (reply !== undefined) row.reply = reply;
  if (failedReason !== undefined) row.failedReason = failedReason;
  return row;
}
