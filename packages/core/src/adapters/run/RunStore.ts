import type { Run, RunStatus } from "../../protocol/types.js";

export interface RunStoreListByAgentAndSessionOptions {
  status?: RunStatus;
  limit?: number;
  cursor?: string;
  order?: "asc" | "desc";
}

export interface RunStoreListResult {
  runs: Run[];
  nextCursor?: string;
}

/**
 * Persists `Run` objects for `wait`/`resume` across processes.
 *
 * In a single-process app, `InMemoryRunStore` works.
 * In a cluster, use a Redis- or DB-backed implementation so any worker
 * can resume a run started on a different node.
 *
 * See docs/core/19-cluster-deployment.md §3.
 */
export interface RunStore {
  save(run: Run): Promise<void>;
  /**
   * Atomically persist `run` only if the stored document for `run.runId` exists and
   * `status === expectedStatus`. Returns whether the write happened. Used after **`resume`**
   * (and in-process **`wait`** continuations) so two workers cannot both overwrite a **`waiting`** run.
   */
  saveIfStatus(run: Run, expectedStatus: RunStatus): Promise<boolean>;
  load(runId: string): Promise<Run | null>;
  delete(runId: string): Promise<void>;
  listByAgent(agentId: string, status?: RunStatus): Promise<Run[]>;
  listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: RunStoreListByAgentAndSessionOptions,
  ): Promise<RunStoreListResult>;
}
