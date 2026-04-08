import { randomUUID } from "node:crypto";
import type { AgentMessage, MessageBus } from "@agent-runtime/core";

/**
 * Redis Streams–backed {@link MessageBus} for multi-process / cluster setups.
 * Uses the same Upstash Redis REST endpoint as {@link UpstashRedisMemoryAdapter}.
 *
 * Stream key per recipient: `bus:agent:{toAgentId}`. Messages are stored as
 * `XADD ... payload <json>` (full {@link AgentMessage} including `id`).
 *
 * `waitFor` polls `XRANGE` (REST-friendly; avoids long `BLOCK` HTTP hangs).
 * Trim old entries on send (`XTRIM` ~ 2000) to bound stream size.
 */
export class UpstashRedisMessageBus implements MessageBus {
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
    await this.cmd(["XADD", key, "*", "payload", JSON.stringify(msg)]);
    await this.cmd(["XTRIM", key, "MAXLEN", "~", "2000"]);
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
      const raw = await this.cmd(["XRANGE", key, "-", "+"]);
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
    const payload = extractPayloadField(fields);
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
