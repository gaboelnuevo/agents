import type { Run, RunStatus } from "../../protocol/types.js";
import type { RunStore } from "./RunStore.js";

/** In-process run store — suitable for tests and single-process deployments only. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();

  async save(run: Run): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
  }

  async load(runId: string): Promise<Run | null> {
    const r = this.runs.get(runId);
    return r ? structuredClone(r) : null;
  }

  async delete(runId: string): Promise<void> {
    this.runs.delete(runId);
  }

  async listByAgent(agentId: string, status?: RunStatus): Promise<Run[]> {
    const out: Run[] = [];
    for (const r of this.runs.values()) {
      if (r.agentId !== agentId) continue;
      if (status !== undefined && r.status !== status) continue;
      out.push(structuredClone(r));
    }
    return out;
  }
}
