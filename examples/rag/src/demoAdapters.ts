/**
 * Demo-only replacements for production embedding + vector services.
 * Not used by `file_ingest` directly: the RAG tool uses whatever you pass into `AgentRuntime`.
 */
import type {
  EmbeddingAdapter,
  VectorAdapter,
  VectorDeleteParams,
  VectorDocument,
  VectorQuery,
  VectorResult,
} from "@agent-runtime/core";

const DIM = 64;

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function embedSync(text: string): number[] {
  const v = new Float64Array(DIM);
  for (const w of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    }
    v[Math.abs(h) % DIM] += 1;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

function cosine(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i]! * b[i]!;
  return d;
}

export function createDemoEmbeddingAdapter(): EmbeddingAdapter {
  return {
    dimensions: DIM,
    embed: (text) => Promise.resolve(embedSync(text)),
    embedBatch: (texts) => Promise.resolve(texts.map(embedSync)),
  };
}

export function createDemoVectorAdapter(): VectorAdapter {
  const byNs = new Map<string, VectorDocument[]>();

  return {
    async upsert(namespace, documents) {
      const cur = byNs.get(namespace) ?? [];
      const index = new Map(cur.map((d) => [d.id, d]));
      for (const d of documents) index.set(d.id, d);
      byNs.set(namespace, [...index.values()]);
    },

    async query(namespace, params) {
      const docs = byNs.get(namespace) ?? [];
      if (params.vector.length === 0) {
        return docs.slice(0, params.topK).map((d) => ({
          id: d.id,
          score: 1,
          data: d.data,
          metadata: d.metadata,
        }));
      }
      return docs
        .map((d) => ({
          id: d.id,
          score: cosine(params.vector, d.vector),
          data: d.data,
          metadata: d.metadata,
        }))
        .filter((r) =>
          params.scoreThreshold != null ? r.score >= params.scoreThreshold : true,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, params.topK);
    },

    async delete(namespace, params: VectorDeleteParams) {
      let docs = byNs.get(namespace) ?? [];
      if (params.deleteAll) docs = [];
      else if (params.ids?.length) {
        const drop = new Set(params.ids);
        docs = docs.filter((d) => !drop.has(d.id));
      }
      byNs.set(namespace, docs);
    },
  };
}
