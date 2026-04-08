import type { MemoryAdapter, MemoryScope } from "./MemoryAdapter.js";

type Key = string;

function scopeKey(scope: MemoryScope): Key {
  return `${scope.projectId}:${scope.agentId}:${scope.sessionId}`;
}

/**
 * In-memory adapter for tests and local dev. Not durable across process restarts.
 *
 * **Not suitable for cluster deployments** — data lives in the heap of a single
 * process. Use `UpstashRedisMemoryAdapter` or another shared-store adapter in
 * production. See docs/core/19-cluster-deployment.md §1.2.
 */
export class InMemoryMemoryAdapter implements MemoryAdapter {
  private readonly store = new Map<Key, Map<string, unknown[]>>();
  private readonly state = new Map<Key, unknown>();

  async save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void> {
    const k = scopeKey(scope);
    if (!this.store.has(k)) this.store.set(k, new Map());
    const m = this.store.get(k)!;
    const list = m.get(memoryType) ?? [];
    list.push(content);
    m.set(memoryType, list);
  }

  async query(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<unknown[]> {
    const k = scopeKey(scope);
    const m = this.store.get(k);
    if (!m) return [];
    return [...(m.get(memoryType) ?? [])];
  }

  async delete(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<void> {
    const k = scopeKey(scope);
    const m = this.store.get(k);
    if (!m) return;
    m.delete(memoryType);
  }

  async getState(scope: MemoryScope): Promise<unknown> {
    const k = scopeKey(scope);
    return this.state.get(k) ?? {};
  }
}
