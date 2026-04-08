import type { Run, RunStatus } from "../../protocol/types.js";

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
  load(runId: string): Promise<Run | null>;
  delete(runId: string): Promise<void>;
  listByAgent(agentId: string, status?: RunStatus): Promise<Run[]>;
}
