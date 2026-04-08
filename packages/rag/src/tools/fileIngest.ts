import type { ToolAdapter, ToolContext, EmbeddingAdapter, VectorAdapter } from "@agent-runtime/core";
import { resolveSource, parseFile, chunkText } from "@agent-runtime/utils";
import type { ChunkOptions } from "@agent-runtime/utils";

function getVectorNamespace(ctx: ToolContext): string {
  const endUserId = (ctx as unknown as Record<string, unknown>).endUserId as string | undefined;
  return endUserId
    ? `${ctx.projectId}:${ctx.agentId}:eu:${endUserId}`
    : `${ctx.projectId}:${ctx.agentId}`;
}

function requireAdapter<T>(ctx: ToolContext, key: string): T {
  const adapter = (ctx as unknown as Record<string, unknown>)[key];
  if (!adapter) {
    throw new Error(`${key} is required for file_ingest.`);
  }
  return adapter as T;
}

export const fileIngestTool: ToolAdapter = {
  name: "file_ingest",
  description:
    "Ingests a file into the vector knowledge base. " +
    "Reads, splits into chunks, generates embeddings, and stores them.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      source: string;
      chunkStrategy?: Partial<ChunkOptions>;
      metadata?: Record<string, unknown>;
    };

    const embedding = requireAdapter<EmbeddingAdapter>(ctx, "embeddingAdapter");
    const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");

    const resolved = await resolveSource(o.source);
    const parsed = await parseFile(resolved.buffer, resolved.mimeType);

    const strategy: ChunkOptions = {
      method: o.chunkStrategy?.method ?? "recursive",
      maxTokens: o.chunkStrategy?.maxTokens ?? 512,
      overlap: o.chunkStrategy?.overlap ?? 50,
    };

    const chunks = chunkText(parsed.text, strategy);
    const texts = chunks.map((c) => c.content);
    const vectors = await embedding.embedBatch(texts);

    const documentId = `doc_${Date.now()}`;
    const docs = chunks.map((c, i) => ({
      id: `${documentId}_chunk_${i}`,
      vector: vectors[i]!,
      data: c.content,
      metadata: {
        ...o.metadata,
        documentId,
        source: o.source,
        chunkIndex: c.index,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        fileName: resolved.name,
        mimeType: resolved.mimeType,
      },
    }));

    await vector.upsert(getVectorNamespace(ctx), docs);

    return {
      success: true,
      documentId,
      chunksCreated: chunks.length,
      status: "completed",
    };
  },
};

export const fileIngestDefinition = {
  id: "file_ingest",
  scope: "global" as const,
  description: fileIngestTool.description!,
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "File path, URL, or storage reference" },
      chunkStrategy: {
        type: "object",
        properties: {
          method: { enum: ["fixed_size", "sentence", "paragraph", "recursive"] },
          maxTokens: { type: "number" },
          overlap: { type: "number" },
        },
      },
      metadata: { type: "object", description: "Extra metadata for all chunks" },
    },
    required: ["source"],
  },
  roles: ["admin", "operator"],
};
