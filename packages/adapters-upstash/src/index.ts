import type {
  MemoryAdapter,
  MemoryScope,
  VectorAdapter,
  VectorDeleteParams,
  VectorDocument,
  VectorQuery,
  VectorResult,
} from "@agent-runtime/core";
import {
  appendMemoryListEntryUpstash,
  readMemoryListUpstash,
} from "./upstashMemoryList.js";

function scopePrefix(scope: MemoryScope): string {
  const eu = scope.endUserId ? `eu:${scope.endUserId}` : "sess";
  return `m:${scope.projectId}:${scope.agentId}:${scope.sessionId}:${eu}`;
}

/**
 * Memory adapter backed by Upstash Redis REST. Each memory type uses a Redis **LIST** (`RPUSH`)
 * for atomic append under concurrency; legacy STRING blobs (JSON array) migrate on first write.
 * Uses `fetch` only — add `@upstash/redis` in your app if you prefer the official client.
 */
export class UpstashRedisMemoryAdapter implements MemoryAdapter {
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

  async save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void> {
    const key = `${scopePrefix(scope)}:${memoryType}`;
    await appendMemoryListEntryUpstash((a) => this.cmd(a), key, content);
  }

  async query(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<unknown[]> {
    const key = `${scopePrefix(scope)}:${memoryType}`;
    return readMemoryListUpstash((a) => this.cmd(a), key);
  }

  async delete(scope: MemoryScope, memoryType: string, _filter?: unknown): Promise<void> {
    const key = `${scopePrefix(scope)}:${memoryType}`;
    await this.cmd(["DEL", key]);
  }

  async getState(scope: MemoryScope): Promise<unknown> {
    const key = `${scopePrefix(scope)}:state`;
    const raw = await this.cmd(["GET", key]);
    if (raw == null || raw === "") return {};
    if (typeof raw !== "string") return {};
    return JSON.parse(raw) as unknown;
  }
}

/** Upstash Vector REST — minimal `query` / `upsert` / `delete` via HTTP. */
export class UpstashVectorAdapter implements VectorAdapter {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Upstash Vector ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async upsert(namespace: string, documents: VectorDocument[]): Promise<void> {
    await this.post(`/upsert/${encodeURIComponent(namespace)}`, {
      vectors: documents.map((d) => ({
        id: d.id,
        vector: d.vector,
        metadata: { data: d.data, ...d.metadata },
      })),
    });
  }

  async query(namespace: string, params: VectorQuery): Promise<VectorResult[]> {
    const data = (await this.post(`/query/${encodeURIComponent(namespace)}`, {
      vector: params.vector,
      topK: params.topK,
      includeMetadata: params.includeMetadata ?? true,
      includeData: params.includeData ?? true,
      filter: params.filter,
      scoreThreshold: params.scoreThreshold,
    })) as { result?: VectorResult[] };
    return data.result ?? [];
  }

  async delete(namespace: string, params: VectorDeleteParams): Promise<void> {
    await this.post(`/delete/${encodeURIComponent(namespace)}`, {
      ids: params.ids,
      filter: params.filter,
      deleteAll: params.deleteAll,
    });
  }
}

export { UpstashRunStore } from "./UpstashRunStore.js";
export { UpstashRedisMessageBus } from "./UpstashRedisMessageBus.js";
