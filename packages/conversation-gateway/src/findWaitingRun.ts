import type { RunStore } from "@agent-runtime/core";

/**
 * Convenience implementation of {@link WaitingRunLookup} using a {@link RunStore}.
 * Lists **waiting** runs for `agentId` and picks the one whose `sessionId` matches.
 */
export async function findWaitingRunIdFromRunStore(
  runStore: RunStore,
  sessionId: string,
  agentId: string,
): Promise<string | undefined> {
  const waiting = await runStore.listByAgent(agentId, "waiting");
  return waiting.find((r) => r.sessionId === sessionId)?.runId;
}
