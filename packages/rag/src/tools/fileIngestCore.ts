import type { ToolContext, EmbeddingAdapter, VectorAdapter } from "@agent-runtime/core";
import { parseFile, chunkText } from "@agent-runtime/utils";
import type { ChunkOptions } from "@agent-runtime/utils";
import { resolveSourceForTool } from "./resolveFileSource.js";

function getVectorNamespace(ctx: ToolContext): string {
  const endUserId = (ctx as unknown as Record<string, unknown>).endUserId as string | undefined;
  return endUserId
    ? `${ctx.projectId}:${ctx.agentId}:eu:${endUserId}`
    : `${ctx.projectId}:${ctx.agentId}`;
}

function requireAdapter<T>(ctx: ToolContext, key: string): T {
  const adapter = (ctx as unknown as Record<string, unknown>)[key];
  if (!adapter) {
    throw new Error(`${key} is required for file ingest.`);
  }
  return adapter as T;
}

export interface FileIngestOptions {
  chunkStrategy?: Partial<ChunkOptions>;
  metadata?: Record<string, unknown>;
}

/**
 * Shared pipeline: resolve → parse → chunk → embed → upsert.
 * Used by `file_ingest` and `ingest_rag_source`.
 */
export async function runFileIngestPipeline(
  ctx: ToolContext,
  source: string,
  opts: FileIngestOptions = {},
): Promise<{ success: true; documentId: string; chunksCreated: number; status: "completed" }> {
  const embedding = requireAdapter<EmbeddingAdapter>(ctx, "embeddingAdapter");
  const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");

  const resolved = await resolveSourceForTool(source, ctx);
  const parsed = await parseFile(resolved.buffer, resolved.mimeType);

  const strategy: ChunkOptions = {
    method: opts.chunkStrategy?.method ?? "recursive",
    maxTokens: opts.chunkStrategy?.maxTokens ?? 512,
    overlap: opts.chunkStrategy?.overlap ?? 50,
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
      ...opts.metadata,
      documentId,
      source,
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
}
