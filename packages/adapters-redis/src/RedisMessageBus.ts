import { randomUUID } from "node:crypto";
import type { AgentMessage, MessageBus } from "@agent-runtime/core";
import type Redis from "ioredis";

/**
 * Redis Streams–backed {@link MessageBus} for TCP Redis (`ioredis`).
 * Same stream layout as {@link UpstashRedisMessageBus}: `bus:agent:{toAgentId}`,
 * field `payload` = JSON {@link AgentMessage}.
 */
export class RedisMessageBus implements MessageBus {
  constructor(private readonly redis: Redis) {}

  private streamKey(toAgentId: string): string {
    return `bus:agent:${toAgentId}`;
  }

  async send(partial: Omit<AgentMessage, "id">): Promise<void> {
    const msg: AgentMessage = {
      ...partial,
      id: randomUUID(),
      meta: partial.meta ?? { ts: new Date().toISOString() },
    };
    const key = this.streamKey(msg.toAgentId);
    await this.redis.xadd(key, "*", "payload", JSON.stringify(msg));
    await this.redis.xtrim(key, "MAXLEN", "~", 2000);
  }

  async waitFor(
    agentId: string,
    filter: { correlationId?: string; fromAgentId?: string },
    options?: { timeoutMs?: number },
  ): Promise<AgentMessage> {
    const timeout = options?.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeout;
    const key = this.streamKey(agentId);
    const seen = new Set<string>();

    const matches = (msg: AgentMessage): boolean => {
      if (filter.correlationId && msg.correlationId !== filter.correlationId)
        return false;
      if (filter.fromAgentId && msg.fromAgentId !== filter.fromAgentId)
        return false;
      return true;
    };

    while (Date.now() < deadline) {
      const raw = await this.redis.xrange(key, "-", "+");
      const entries = parseXrangeEntries(raw);
      for (const { id, payload } of entries) {
        if (seen.has(id)) continue;
        seen.add(id);
        let msg: AgentMessage;
        try {
          msg = JSON.parse(payload) as AgentMessage;
        } catch {
          continue;
        }
        if (matches(msg)) return msg;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`MessageBus.waitFor timed out after ${timeout}ms`);
  }
}

function parseXrangeEntries(
  raw: unknown,
): Array<{ id: string; payload: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; payload: string }> = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const id = String(row[0]);
    const fields = row[1];
    if (!Array.isArray(fields)) continue;
    const payload = extractPayloadField(fields as unknown[]);
    if (payload !== undefined) out.push({ id, payload });
  }
  return out;
}

function extractPayloadField(fields: unknown[]): string | undefined {
  for (let i = 0; i < fields.length - 1; i++) {
    if (fields[i] === "payload") return String(fields[i + 1]);
  }
  return undefined;
}
