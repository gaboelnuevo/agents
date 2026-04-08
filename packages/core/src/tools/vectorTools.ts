import type { ToolAdapter, ToolContext } from "../adapters/tool/ToolAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embedding/EmbeddingAdapter.js";
import type { VectorAdapter, VectorDocument } from "../adapters/vector/VectorAdapter.js";
import { registerToolDefinition, registerToolHandler } from "../define/registry.js";
import {
  clampVectorTopK,
  isValidVectorDeleteInput,
  MAX_VECTOR_UPSERT_DOCS,
} from "./vectorLimits.js";

function getVectorNamespace(ctx: ToolContext): string {
  return ctx.endUserId
    ? `${ctx.projectId}:${ctx.agentId}:eu:${ctx.endUserId}`
    : `${ctx.projectId}:${ctx.agentId}`;
}

function requireAdapter<T>(ctx: ToolContext, key: string): T {
  const adapter = (ctx as Record<string, unknown>)[key];
  if (!adapter) {
    throw new Error(
      `${key} is required for vector tools. Pass it via AgentRuntime({ embeddingAdapter, vectorAdapter }).`,
    );
  }
  return adapter as T;
}

const vectorSearch: ToolAdapter = {
  name: "vector_search",
  description: "Searches the knowledge base for semantically relevant fragments.",
  validate(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    const o = input as Record<string, unknown>;
    return typeof o.query === "string" && o.query.trim().length > 0;
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      query: string;
      topK?: number;
      scoreThreshold?: number;
      filter?: Record<string, unknown>;
    };
    const embedding = requireAdapter<EmbeddingAdapter>(ctx, "embeddingAdapter");
    const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");
    const qv = await embedding.embed(o.query);
    const results = await vector.query(getVectorNamespace(ctx), {
      vector: qv,
      topK: clampVectorTopK(o.topK),
      scoreThreshold: o.scoreThreshold,
      filter: o.filter,
      includeData: true,
      includeMetadata: true,
    });
    return { success: true, results };
  },
};

const vectorUpsert: ToolAdapter = {
  name: "vector_upsert",
  description: "Stores text fragments with embeddings in the knowledge base.",
  validate(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    const o = input as { documents?: unknown };
    if (!Array.isArray(o.documents)) return false;
    if (o.documents.length === 0 || o.documents.length > MAX_VECTOR_UPSERT_DOCS)
      return false;
    return o.documents.every(
      (d) =>
        d &&
        typeof d === "object" &&
        typeof (d as { content?: unknown }).content === "string",
    );
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      documents: Array<{ id?: string; content: string; metadata?: Record<string, unknown> }>;
    };
    const embedding = requireAdapter<EmbeddingAdapter>(ctx, "embeddingAdapter");
    const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");
    const contents = o.documents.map((d) => d.content);
    const vectors = await embedding.embedBatch(contents);
    const docs: VectorDocument[] = o.documents.map((d, i) => ({
      id: d.id ?? `${Date.now()}-${i}`,
      vector: vectors[i]!,
      data: d.content,
      metadata: d.metadata,
    }));
    await vector.upsert(getVectorNamespace(ctx), docs);
    return { success: true, stored: docs.length };
  },
};

const vectorDelete: ToolAdapter = {
  name: "vector_delete",
  description: "Deletes fragments from the knowledge base by ID or metadata filter.",
  validate: isValidVectorDeleteInput,
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      ids?: string[];
      filter?: Record<string, unknown>;
    };
    const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");
    await vector.delete(getVectorNamespace(ctx), {
      ids: o.ids,
      filter: o.filter,
    });
    return { success: true };
  },
};

export function registerVectorToolHandlers(): void {
  registerToolDefinition({
    id: "vector_search",
    scope: "global",
    description: vectorSearch.description!,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        topK: { type: "number" },
        scoreThreshold: { type: "number" },
        filter: { type: "object" },
      },
      required: ["query"],
    },
    roles: ["agent"],
  });
  registerToolDefinition({
    id: "vector_upsert",
    scope: "global",
    description: vectorUpsert.description!,
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              metadata: { type: "object" },
            },
            required: ["content"],
          },
        },
      },
      required: ["documents"],
    },
    roles: ["agent"],
  });
  registerToolDefinition({
    id: "vector_delete",
    scope: "global",
    description: vectorDelete.description!,
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        filter: { type: "object" },
      },
    },
    roles: ["admin", "operator"],
  });
  registerToolHandler(vectorSearch);
  registerToolHandler(vectorUpsert);
  registerToolHandler(vectorDelete);
}
