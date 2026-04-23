import type { RunStore } from "@opencoreagents/core";

/**
 * Convenience implementation of {@link WaitingRunLookup} using a {@link RunStore}.
 * Queries **waiting** runs for `agentId` + `sessionId` directly and returns the newest match.
 */
export async function findWaitingRunIdFromRunStore(
  runStore: RunStore,
  sessionId: string,
  agentId: string,
): Promise<string | undefined> {
  const { runs } = await runStore.listByAgentAndSession(agentId, sessionId, {
    status: "waiting",
    limit: 1,
    order: "desc",
  });
  return runs[0]?.runId;
}
