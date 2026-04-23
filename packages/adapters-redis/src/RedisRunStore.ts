import type {
  Run,
  RunStatus,
  RunStore,
  RunStoreListByAgentAndSessionOptions,
  RunStoreListResult,
} from "@opencoreagents/core";
import type Redis from "ioredis";

function sessionIndexKey(agentId: string, sessionId: string): string {
  return `run:agent-session:${agentId}:${sessionId}`;
}

function runRecencyScore(run: Run): number {
  const lastTs = run.history[run.history.length - 1]?.meta.ts;
  const parsed = lastTs ? Date.parse(lastTs) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Persists {@link Run} JSON in Redis — same keys as {@link UpstashRunStore}
 * (`run:data:{runId}`, `run:agent:{agentId}` SET).
 */
export class RedisRunStore implements RunStore {
  constructor(private readonly redis: Redis) {}

  async save(run: Run): Promise<void> {
    const key = `run:data:${run.runId}`;
    const tx = this.redis.multi().set(key, JSON.stringify(run)).sadd(`run:agent:${run.agentId}`, run.runId);
    if (run.sessionId) {
      tx.zadd(sessionIndexKey(run.agentId, run.sessionId), runRecencyScore(run), run.runId);
    }
    await tx.exec();
  }

  async saveIfStatus(run: Run, expectedStatus: RunStatus): Promise<boolean> {
    const key = `run:data:${run.runId}`;
    const agentKey = `run:agent:${run.agentId}`;
    await this.redis.watch(key);
    const raw = await this.redis.get(key);
    if (raw == null || raw === "") {
      await this.redis.unwatch();
      return false;
    }
    let existing: Run;
    try {
      existing = JSON.parse(raw) as Run;
    } catch {
      await this.redis.unwatch();
      return false;
    }
    if (existing.status !== expectedStatus) {
      await this.redis.unwatch();
      return false;
    }
    const tx = this.redis.multi().set(key, JSON.stringify(run)).sadd(agentKey, run.runId);
    if (run.sessionId) {
      tx.zadd(sessionIndexKey(run.agentId, run.sessionId), runRecencyScore(run), run.runId);
    }
    const execResult = await tx.exec();
    return execResult != null;
  }

  async load(runId: string): Promise<Run | null> {
    const raw = await this.redis.get(`run:data:${runId}`);
    if (raw == null || raw === "") return null;
    return JSON.parse(raw) as Run;
  }

  async delete(runId: string): Promise<void> {
    const existing = await this.load(runId);
    const tx = this.redis.multi().del(`run:data:${runId}`);
    if (existing) {
      tx.srem(`run:agent:${existing.agentId}`, runId);
      if (existing.sessionId) {
        tx.zrem(sessionIndexKey(existing.agentId, existing.sessionId), runId);
      }
    }
    await tx.exec();
  }

  async listByAgent(agentId: string, status?: RunStatus): Promise<Run[]> {
    const ids = await this.redis.smembers(`run:agent:${agentId}`);
    const out: Run[] = [];
    for (const id of ids) {
      const run = await this.load(id);
      if (!run) continue;
      if (status !== undefined && run.status !== status) continue;
      out.push(run);
    }
    return out;
  }

  async listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: RunStoreListByAgentAndSessionOptions,
  ): Promise<RunStoreListResult> {
    const order = opts?.order ?? "desc";
    const limit = Math.max(1, opts?.limit ?? 50);
    const offset = parseCursor(opts?.cursor);
    const stop = offset + limit;
    const key = sessionIndexKey(agentId, sessionId);
    const ids =
      order === "asc"
        ? await this.redis.zrange(key, offset, stop)
        : await this.redis.zrevrange(key, offset, stop);
    const runs: Run[] = [];
    for (const id of ids) {
      const run = await this.load(id);
      if (!run) continue;
      if (run.sessionId !== sessionId) continue;
      if (opts?.status !== undefined && run.status !== opts.status) continue;
      runs.push(run);
    }
    return {
      runs: runs.slice(0, limit),
      nextCursor: ids.length > limit ? String(offset + limit) : undefined,
    };
  }
}
