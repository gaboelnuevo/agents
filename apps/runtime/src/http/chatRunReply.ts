import type { Run, RunStore } from "@opencoreagents/core";

function isRunLike(v: unknown): v is Run {
  return (
    v != null &&
    typeof v === "object" &&
    "runId" in v &&
    typeof (v as Run).runId === "string" &&
    "status" in v &&
    typeof (v as Run).status === "string"
  );
}

/**
 * Pick the best {@link Run} snapshot after a chat job completes (`wait` path).
 *
 * - Prefer **Redis** when it has **at least as much** `history` as the job return value (normal steady state).
 * - If the store row **lags** the worker `returnvalue` (**shorter** `history`), use the candidate so a
 *   follow-up **`continue`** after **`invoke_planner`** does not surface the **previous** turn's `result`.
 */
export async function resolveRunForChatReply(store: RunStore, candidate: unknown): Promise<Run | null> {
  if (!isRunLike(candidate)) return null;
  const persisted = await store.load(candidate.runId);
  if (persisted == null) return candidate;
  if (persisted.history.length < candidate.history.length) return candidate;
  return persisted;
}
