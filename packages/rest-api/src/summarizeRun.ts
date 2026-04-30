import type { Run } from "@opencoreagents/core";

/** Compact summary of a **`Run`** for job payloads, tools, and HTTP JSON. */
export interface EngineRunSummary {
  status: Run["status"];
  runId: string;
  /** Last **`result`** step **`content`** in **`run.history`**, if any. */
  reply: string | undefined;
  /**
   * Optional short suggested replies (for chat UIs, bots, quick-reply chips).
   * Returned only when the final result content can be parsed as JSON carrying `short_answers`.
   */
  short_answers: string[] | undefined;
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
  let reply: string | undefined =
    result && typeof result.content === "string" ? result.content : undefined;
  let shortAnswers: string[] | undefined;
  if (reply) {
    const parsed = parseReplyEnvelope(reply);
    if (parsed) {
      reply = parsed.reply;
      shortAnswers = parsed.shortAnswers;
    }
  }
  const failedReason =
    typeof run.state.failedReason === "string" && run.state.failedReason.trim()
      ? run.state.failedReason.trim()
      : undefined;
  return {
    status: run.status,
    runId: run.runId,
    reply,
    short_answers: shortAnswers,
    failedReason,
  };
}

function parseReplyEnvelope(
  raw: string,
): { reply: string; shortAnswers?: string[] } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const replyCandidate =
      typeof parsed.reply === "string"
        ? parsed.reply
        : typeof parsed.content === "string"
          ? parsed.content
          : null;
    if (!replyCandidate) return null;
    const reply = replyCandidate.trim();
    if (!reply) return null;
    const shortRaw = parsed.short_answers;
    const shortAnswers =
      Array.isArray(shortRaw) && shortRaw.length > 0
        ? shortRaw
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter((x) => x.length > 0)
        : undefined;
    return shortAnswers && shortAnswers.length > 0 ? { reply, shortAnswers } : { reply };
  } catch {
    return null;
  }
}

/** Compact row for **`GET /agents/:agentId/runs`** (dashboards — not full step log). */
export interface RuntimeRestRunListItem {
  runId: string;
  agentId: string;
  sessionId?: string;
  projectId?: string;
  tenantId?: string;
  status: Run["status"];
  iteration: number;
  historyStepCount: number;
  userInput?: string;
  reply?: string;
  short_answers?: string[];
  failedReason?: string;
}

export function summarizeRunListEntry(run: Run): RuntimeRestRunListItem {
  const { reply, short_answers, failedReason } = summarizeEngineRun(run);
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
  if (run.tenantId !== undefined) row.tenantId = run.tenantId;
  if (userInput !== undefined) row.userInput = userInput;
  if (reply !== undefined) row.reply = reply;
  if (short_answers !== undefined) row.short_answers = short_answers;
  if (failedReason !== undefined) row.failedReason = failedReason;
  return row;
}
