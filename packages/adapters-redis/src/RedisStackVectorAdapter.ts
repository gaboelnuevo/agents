import type { VectorAdapter, VectorDeleteParams, VectorDocument, VectorQuery, VectorResult } from "@opencoreagents/core";
import type Redis from "ioredis";

type RedisStackDistanceMetric = "COSINE" | "L2" | "IP";

export interface RedisStackVectorAdapterOptions {
  indexPrefix?: string;
  keyPrefix?: string;
  dataField?: string;
  metadataField?: string;
  vectorField?: string;
  distanceMetric?: RedisStackDistanceMetric;
  queryExpansionFactor?: number;
}

const DEFAULTS: Required<RedisStackVectorAdapterOptions> = {
  indexPrefix: "vecidx:",
  keyPrefix: "vecdoc:",
  dataField: "data",
  metadataField: "metadata",
  vectorField: "vector",
  distanceMetric: "COSINE",
  queryExpansionFactor: 5,
};

interface SearchHit {
  key: string;
  fields: Record<string, string>;
}

/**
 * Redis Stack (`RediSearch`) vector adapter over TCP `ioredis`.
 *
 * The adapter lazily creates one vector index per `namespace` on first upsert/query,
 * infers vector dimensions from the first write, and stores each document as a Redis HASH.
 */
export class RedisStackVectorAdapter implements VectorAdapter {
  private readonly opts: Required<RedisStackVectorAdapterOptions>;
  private readonly knownDimensions = new Map<string, number>();
  private readonly ensuredIndexes = new Set<string>();

  constructor(
    private readonly redis: Redis,
    options: RedisStackVectorAdapterOptions = {},
  ) {
    this.opts = {
      ...DEFAULTS,
      ...options,
      distanceMetric: (options.distanceMetric ?? DEFAULTS.distanceMetric).toUpperCase() as RedisStackDistanceMetric,
    };
  }

  async upsert(namespace: string, documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const dims = this.assertVectorDimensions(namespace, documents[0]!.vector);
    await this.ensureIndex(namespace, dims);

    const tx = this.redis.multi();
    for (const doc of documents) {
      this.assertDimensionsEqual(namespace, doc.vector, dims);
      const key = this.documentKey(namespace, doc.id);
      tx.call(
        "HSET",
        key,
        this.opts.dataField,
        doc.data,
        this.opts.metadataField,
        JSON.stringify(doc.metadata ?? {}),
        this.opts.vectorField,
        this.vectorToBuffer(doc.vector),
      );
    }
    await tx.exec();
  }

  async query(namespace: string, params: VectorQuery): Promise<VectorResult[]> {
    if (params.topK <= 0) return [];

    const dims = this.assertVectorDimensions(namespace, params.vector);
    await this.ensureIndex(namespace, dims);

    const requestedTopK = Math.max(1, params.topK);
    const queryTopK = params.filter
      ? Math.max(requestedTopK, requestedTopK * this.opts.queryExpansionFactor)
      : requestedTopK;

    const args: [string, ...(string | Buffer)[]] = [
      "FT.SEARCH",
      this.indexName(namespace),
      `*=>[KNN ${queryTopK} @${this.opts.vectorField} $vec AS __score]`,
      "PARAMS",
      "2",
      "vec",
      this.vectorToBuffer(params.vector),
      "SORTBY",
      "__score",
      "ASC",
      "LIMIT",
      "0",
      String(queryTopK),
      "DIALECT",
      "2",
      "RETURN",
      "3",
      "__score",
      this.opts.dataField,
      this.opts.metadataField,
    ];

    const [queryCommand, ...queryArgs] = args;
    const raw = await this.redis.call(queryCommand, ...queryArgs);
    const hits = this.parseSearchReply(raw);
    const out: VectorResult[] = [];

    for (const hit of hits) {
      const metadata = this.parseMetadata(hit.fields[this.opts.metadataField]);
      if (params.filter && !matchesFilter(metadata, params.filter)) continue;

      const distance = Number(hit.fields.__score ?? "NaN");
      if (!Number.isFinite(distance)) continue;
      const score = this.distanceToScore(distance);
      if (
        params.scoreThreshold !== undefined &&
        Number.isFinite(params.scoreThreshold) &&
        score < params.scoreThreshold
      ) {
        continue;
      }

      out.push({
        id: this.idFromKey(namespace, hit.key),
        score,
        ...(params.includeData !== false ? { data: hit.fields[this.opts.dataField] ?? "" } : {}),
        ...(params.includeMetadata !== false ? { metadata } : {}),
      });

      if (out.length >= requestedTopK) break;
    }

    return out;
  }

  async delete(namespace: string, params: VectorDeleteParams): Promise<void> {
    const keysToDelete = new Set<string>();

    if (params.deleteAll) {
      for (const key of await this.scanKeys(this.documentPattern(namespace))) {
        keysToDelete.add(key);
      }
    }

    if (params.ids?.length) {
      for (const id of params.ids) {
        keysToDelete.add(this.documentKey(namespace, id));
      }
    }

    if (params.filter) {
      const keys = await this.scanKeys(this.documentPattern(namespace));
      for (const key of keys) {
        const raw = await this.redis.call("HGET", key, this.opts.metadataField);
        const metadata = this.parseMetadata(this.decodeRedisValue(raw));
        if (matchesFilter(metadata, params.filter)) {
          keysToDelete.add(key);
        }
      }
    }

    if (keysToDelete.size > 0) {
      await this.redis.del(...Array.from(keysToDelete));
    }
  }

  private assertVectorDimensions(namespace: string, vector: number[]): number {
    if (vector.length === 0) {
      throw new Error("Vector must have at least one dimension.");
    }
    const known = this.knownDimensions.get(namespace);
    if (known !== undefined) {
      this.assertDimensionsEqual(namespace, vector, known);
      return known;
    }
    this.knownDimensions.set(namespace, vector.length);
    return vector.length;
  }

  private assertDimensionsEqual(namespace: string, vector: number[], expected: number): void {
    if (vector.length !== expected) {
      throw new Error(
        `Vector dimension mismatch for namespace=${namespace}: expected ${expected}, got ${vector.length}.`,
      );
    }
  }

  private async ensureIndex(namespace: string, dimensions: number): Promise<void> {
    const index = this.indexName(namespace);
    if (this.ensuredIndexes.has(index)) return;

    const args: [string, ...string[]] = [
      "FT.CREATE",
      index,
      "ON",
      "HASH",
      "PREFIX",
      "1",
      this.documentPrefix(namespace),
      "SCHEMA",
      this.opts.dataField,
      "TEXT",
      this.opts.metadataField,
      "TEXT",
      this.opts.vectorField,
      "VECTOR",
      "HNSW",
      "6",
      "TYPE",
      "FLOAT32",
      "DIM",
      String(dimensions),
      "DISTANCE_METRIC",
      this.opts.distanceMetric,
    ];

    try {
      const [createCommand, ...createArgs] = args;
      await this.redis.call(createCommand, ...createArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/index already exists/i.test(message)) {
        throw error;
      }
    }

    this.ensuredIndexes.add(index);
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const reply = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", "250");
      cursor = String(reply[0] ?? "0");
      const batch = Array.isArray(reply[1]) ? reply[1] : [];
      for (const key of batch) keys.push(String(key));
    } while (cursor !== "0");

    return keys;
  }

  private parseSearchReply(raw: unknown): SearchHit[] {
    if (!Array.isArray(raw) || raw.length < 3) return [];

    const hits: SearchHit[] = [];
    for (let i = 1; i < raw.length; i += 2) {
      const keyRaw = raw[i];
      const fieldsRaw = raw[i + 1];
      if (!Array.isArray(fieldsRaw)) continue;

      const fields: Record<string, string> = {};
      for (let j = 0; j < fieldsRaw.length; j += 2) {
        const k = this.decodeRedisValue(fieldsRaw[j]);
        const v = this.decodeRedisValue(fieldsRaw[j + 1]);
        if (!k) continue;
        fields[k] = v;
      }

      hits.push({ key: this.decodeRedisValue(keyRaw), fields });
    }
    return hits;
  }

  private parseMetadata(raw: string): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private vectorToBuffer(vector: number[]): Buffer {
    const arr = Float32Array.from(vector);
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  }

  private decodeRedisValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value == null) return "";
    if (Buffer.isBuffer(value)) return value.toString("utf8");
    return String(value);
  }

  private distanceToScore(distance: number): number {
    switch (this.opts.distanceMetric) {
      case "COSINE":
        return 1 - distance;
      case "L2":
      case "IP":
      default:
        return -distance;
    }
  }

  private indexName(namespace: string): string {
    return `${this.opts.indexPrefix}${namespace}`;
  }

  private documentPrefix(namespace: string): string {
    return `${this.opts.keyPrefix}${namespace}:`;
  }

  private documentPattern(namespace: string): string {
    return `${this.documentPrefix(namespace)}*`;
  }

  private documentKey(namespace: string, id: string): string {
    return `${this.documentPrefix(namespace)}${id}`;
  }

  private idFromKey(namespace: string, key: string): string {
    const prefix = this.documentPrefix(namespace);
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (!(key in metadata)) return false;
    if (!unknownEqual(metadata[key], expected)) return false;
  }
  return true;
}

function unknownEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!unknownEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (a && b && typeof a === "object" && typeof b === "object") {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bEntries = Object.entries(b as Record<string, unknown>);
    if (aEntries.length !== bEntries.length) return false;
    for (const [k, v] of aEntries) {
      if (!(k in (b as Record<string, unknown>))) return false;
      if (!unknownEqual(v, (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }

  return false;
}
