import type { MemoryAdapter, MemoryScope } from "./MemoryAdapter.js";

type Key = string;

/**
 * Storage partition for list memory (`save` / `query` / `delete`).
 * Aligns with `docs/core/15-multi-tenancy.md` §4.3:
 * `longTerm` and `vectorMemory` are keyed by **`endUserId`** when present (shared across sessions);
 * other types use the **session** bucket.
 */
function storagePartitionKey(scope: MemoryScope, memoryType: string): Key {
  const base = `${scope.projectId}:${scope.agentId}`;
  if (
    scope.endUserId &&
    (memoryType === "longTerm" || memoryType === "vectorMemory")
  ) {
    return `${base}:eu:${scope.endUserId}`;
  }
  return `${base}:sess:${scope.sessionId}`;
}

/** Session-scoped working state (`getState` / future setters) — not split by memory type. */
function statePartitionKey(scope: MemoryScope): Key {
  return `${scope.projectId}:${scope.agentId}:sess:${scope.sessionId}`;
}

/**
 * In-memory adapter for tests and local dev. Not durable across process restarts.
 *
 * **`longTerm`** and **`vectorMemory`** use an **`endUserId`** partition when
 * `scope.endUserId` is set (shared across sessions); **`shortTerm`**, **`working`**,
 * and other types are session-scoped. Without **`endUserId`**, **`longTerm`** is
 * session-scoped like other types.
 *
 * **Not suitable for cluster deployments** — data lives in the heap of a single
 * process. Use `RedisMemoryAdapter` / `UpstashRedisMemoryAdapter` in production;
 * their key layout for **`longTerm`** may differ — see `docs/planning/technical-debt-platform-core-ci.md` §1 (memory keys row).
 * See also docs/core/19-cluster-deployment.md §1.2.
 */
export class InMemoryMemoryAdapter implements MemoryAdapter {
  private readonly store = new Map<Key, Map<string, unknown[]>>();
  private readonly state = new Map<Key, unknown>();

  async save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void> {
    const k = storagePartitionKey(scope, memoryType);
    if (!this.store.has(k)) this.store.set(k, new Map());
    const m = this.store.get(k)!;
    const list = m.get(memoryType) ?? [];
    list.push(content);
    m.set(memoryType, list);
  }

  async query(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<unknown[]> {
    const k = storagePartitionKey(scope, memoryType);
    const m = this.store.get(k);
    if (!m) return [];
    return [...(m.get(memoryType) ?? [])];
  }

  async delete(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<void> {
    const k = storagePartitionKey(scope, memoryType);
    const m = this.store.get(k);
    if (!m) return;
    m.delete(memoryType);
  }

  async getState(scope: MemoryScope): Promise<unknown> {
    const k = statePartitionKey(scope);
    return this.state.get(k) ?? {};
  }
}
