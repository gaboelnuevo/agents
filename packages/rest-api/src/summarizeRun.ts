import type { Run } from "@opencoreagents/core";

/** Narrow full **`Run`** history for job **`returnvalue`** and HTTP responses. */
export function summarizeEngineRun(run: Run): {
  status: Run["status"];
  runId: string;
  reply: string | undefined;
} {
  const result = run.history.filter((h) => h.type === "result").pop();
  return {
    status: run.status,
    runId: run.runId,
    reply: result && typeof result.content === "string" ? result.content : undefined,
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
}

export function summarizeRunListEntry(run: Run): RuntimeRestRunListItem {
  const { reply } = summarizeEngineRun(run);
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
  return row;
}
