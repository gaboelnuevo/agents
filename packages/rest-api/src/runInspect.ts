import type { Run, RunStatus, RunStore } from "@opencoreagents/core";

/** `true` when query is `1`, `true`, or `yes` (case-insensitive). */
export function parseQueryFlag(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function resumeInputsFromState(run: Run): string[] | undefined {
  const ri = run.state.resumeInputs;
  return Array.isArray(ri) && ri.length > 0 ? [...ri] : undefined;
}

export function continueInputsFromState(run: Run): string[] | undefined {
  const ci = run.state.continueInputs;
  return Array.isArray(ci) && ci.length > 0 ? [...ci] : undefined;
}

export function lastWaitReason(run: Run): string | undefined {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const m = run.history[i]!;
    if (m.type !== "wait") continue;
    const c = m.content as { reason?: string };
    return typeof c.reason === "string" ? c.reason : undefined;
  }
  return undefined;
}

/**
 * Display timeline: persisted **`history`** plus one synthetic **`observation`**
 * after each **`wait`** so **`resume`** text appears between wait and **`result`** (not stored in **`RunStore`**).
 */
export function historyWithResumeTimeline(run: Run): Run["history"] {
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
        meta: { ts: msg.meta?.ts ?? new Date().toISOString(), source: "engine" },
      });
    }
  }
  return out;
}

export function emptyRunStatusSummary(): Record<RunStatus, number> {
  return { running: 0, waiting: 0, completed: 0, failed: 0 };
}

/**
 * All persisted runs for **`sessionId`** across the given **`agentIds`**, de-duplicated by **`runId`**.
 * Rows with **`run.projectId`** set are skipped when it disagrees with **`projectId`**.
 */
export async function loadRunsForSession(
  store: RunStore,
  options: { sessionId: string; projectId: string; agentIds: string[] },
): Promise<Run[]> {
  const { sessionId, projectId, agentIds } = options;
  const byId = new Map<string, Run>();
  for (const agentId of agentIds) {
    const rows = await store.listByAgent(agentId);
    for (const r of rows) {
      if (r.sessionId !== sessionId) continue;
      if (r.projectId != null && r.projectId !== "" && r.projectId !== projectId) continue;
      byId.set(r.runId, r);
    }
  }
  return [...byId.values()];
}
