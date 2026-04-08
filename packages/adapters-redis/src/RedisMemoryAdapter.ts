import type { MemoryAdapter, MemoryScope } from "@agent-runtime/core";
import type Redis from "ioredis";
import { memoryKeyPrefix } from "./keys.js";
import { appendMemoryListEntry, readMemoryList } from "./memoryListSave.js";

/**
 * Memory adapter using TCP Redis (`ioredis`) — same key semantics as
 * `UpstashRedisMemoryAdapter` in `@agent-runtime/adapters-upstash`.
 *
 * Each memory type uses a Redis **LIST**: `RPUSH` per `save` (atomic append under concurrency).
 * Legacy STRING values (JSON array) are migrated to LIST on first write after upgrade.
 */
export class RedisMemoryAdapter implements MemoryAdapter {
  constructor(private readonly redis: Redis) {}

  async save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void> {
    const key = `${memoryKeyPrefix(scope)}:${memoryType}`;
    await appendMemoryListEntry(this.redis, key, content);
  }

  async query(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<unknown[]> {
    const key = `${memoryKeyPrefix(scope)}:${memoryType}`;
    return readMemoryList(this.redis, key);
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
