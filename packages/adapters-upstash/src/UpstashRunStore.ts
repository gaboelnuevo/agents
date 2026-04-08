import type { Run, RunStatus, RunStore } from "@agent-runtime/core";

/**
 * Persists {@link Run} JSON in Upstash Redis (same REST endpoint as {@link UpstashRedisMemoryAdapter}).
 *
 * Keys:
 * - `run:data:{runId}` — JSON-serialized `Run`
 * - `run:agent:{agentId}` — SET of `runId` values for listing
 */
export class UpstashRunStore implements RunStore {
  /** Atomic CAS in one round-trip (REST cannot `WATCH` across requests). */
  private static readonly SAVE_IF_STATUS_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local expected = ARGV[1]
local status = string.match(raw, '"status":"([^"]*)"')
if not status or status ~= expected then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SADD', 'run:agent:' .. ARGV[3], ARGV[4])
return 1
`;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(`${this.url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(`Upstash Redis ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { result?: unknown };
    return data.result;
  }

  async save(run: Run): Promise<void> {
    const key = `run:data:${run.runId}`;
    await this.cmd(["SET", key, JSON.stringify(run)]);
    await this.cmd(["SADD", `run:agent:${run.agentId}`, run.runId]);
  }

  async saveIfStatus(run: Run, expectedStatus: RunStatus): Promise<boolean> {
    const key = `run:data:${run.runId}`;
    const n = await this.cmd([
      "EVAL",
      UpstashRunStore.SAVE_IF_STATUS_LUA,
      "1",
      key,
      expectedStatus,
      JSON.stringify(run),
      run.agentId,
      run.runId,
    ]);
    return n === 1 || n === true;
  }

  async load(runId: string): Promise<Run | null> {
    const raw = await this.cmd(["GET", `run:data:${runId}`]);
    if (raw == null || raw === "") return null;
    if (typeof raw !== "string") return null;
    return JSON.parse(raw) as Run;
  }

  async delete(runId: string): Promise<void> {
    const existing = await this.load(runId);
    await this.cmd(["DEL", `run:data:${runId}`]);
    if (existing) {
      await this.cmd(["SREM", `run:agent:${existing.agentId}`, runId]);
    }
  }

  async listByAgent(agentId: string, status?: RunStatus): Promise<Run[]> {
    const raw = await this.cmd(["SMEMBERS", `run:agent:${agentId}`]);
    const ids = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === "string"
        ? [raw]
        : [];
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
