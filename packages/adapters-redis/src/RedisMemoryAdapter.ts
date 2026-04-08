import type { MemoryAdapter, MemoryScope } from "@agent-runtime/core";
import type Redis from "ioredis";
import { memoryKeyPrefix } from "./keys.js";

/**
 * Memory adapter using TCP Redis (`ioredis`) — same key semantics as
 * `UpstashRedisMemoryAdapter` in `@agent-runtime/adapters-upstash`.
 */
export class RedisMemoryAdapter implements MemoryAdapter {
  constructor(private readonly redis: Redis) {}

  async save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void> {
    const key = `${memoryKeyPrefix(scope)}:${memoryType}`;
    const raw = await this.redis.get(key);
    const list: unknown[] =
      typeof raw === "string" && raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push(content);
    await this.redis.set(key, JSON.stringify(list));
  }

  async query(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<unknown[]> {
    const key = `${memoryKeyPrefix(scope)}:${memoryType}`;
    const raw = await this.redis.get(key);
    if (raw == null || raw === "") return [];
    return JSON.parse(raw) as unknown[];
  }

  async delete(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<void> {
    const key = `${memoryKeyPrefix(scope)}:${memoryType}`;
    await this.redis.del(key);
  }

  async getState(scope: MemoryScope): Promise<unknown> {
    const key = `${memoryKeyPrefix(scope)}:state`;
    const raw = await this.redis.get(key);
    if (raw == null || raw === "") return {};
    return JSON.parse(raw) as unknown;
  }
}
