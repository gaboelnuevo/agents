import type { Run, RunStatus } from "../../protocol/types.js";
import type { RunStore } from "./RunStore.js";

function runRecencyScore(run: Run): number {
  const lastTs = run.history[run.history.length - 1]?.meta.ts;
  const parsed = lastTs ? Date.parse(lastTs) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** In-process run store — suitable for tests and single-process deployments only. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();

  async save(run: Run): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
  }

  async saveIfStatus(run: Run, expectedStatus: RunStatus): Promise<boolean> {
    const cur = this.runs.get(run.runId);
    if (!cur || cur.status !== expectedStatus) return false;
    this.runs.set(run.runId, structuredClone(run));
    return true;
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

  async listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: {
      status?: RunStatus;
      limit?: number;
      cursor?: string;
      order?: "asc" | "desc";
    },
  ): Promise<{ runs: Run[]; nextCursor?: string }> {
    const order = opts?.order ?? "desc";
    const limit = Math.max(1, opts?.limit ?? 50);
    const offset = parseCursor(opts?.cursor);
    const rows: Run[] = [];
    for (const run of this.runs.values()) {
      if (run.agentId !== agentId) continue;
      if (run.sessionId !== sessionId) continue;
      if (opts?.status !== undefined && run.status !== opts.status) continue;
      rows.push(structuredClone(run));
    }
    rows.sort((a, b) => {
      const diff = runRecencyScore(a) - runRecencyScore(b);
      return order === "asc" ? diff : -diff;
    });
    const page = rows.slice(offset, offset + limit + 1);
    const runs = page.slice(0, limit);
    const nextCursor = page.length > limit ? String(offset + limit) : undefined;
    return { runs, nextCursor };
  }
}
