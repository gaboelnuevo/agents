import type { Run, RunStatus, RunStore } from "@agent-runtime/core";
import type Redis from "ioredis";

/**
 * Persists {@link Run} JSON in Redis — same keys as {@link UpstashRunStore}
 * (`run:data:{runId}`, `run:agent:{agentId}` SET).
 */
export class RedisRunStore implements RunStore {
  constructor(private readonly redis: Redis) {}

  async save(run: Run): Promise<void> {
    const key = `run:data:${run.runId}`;
    await this.redis.set(key, JSON.stringify(run));
    await this.redis.sadd(`run:agent:${run.agentId}`, run.runId);
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
    const execResult = await this.redis
      .multi()
      .set(key, JSON.stringify(run))
      .sadd(agentKey, run.runId)
      .exec();
    return execResult != null;
  }

  async load(runId: string): Promise<Run | null> {
    const raw = await this.redis.get(`run:data:${runId}`);
    if (raw == null || raw === "") return null;
    return JSON.parse(raw) as Run;
  }

  async delete(runId: string): Promise<void> {
    const existing = await this.load(runId);
    await this.redis.del(`run:data:${runId}`);
    if (existing) {
      await this.redis.srem(`run:agent:${existing.agentId}`, runId);
    }
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
}
