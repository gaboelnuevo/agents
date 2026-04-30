import type { ToolContext, EmbeddingAdapter, VectorAdapter } from "@opencoreagents/core";
import { parseFile, chunkText } from "@opencoreagents/utils";
import type { ChunkOptions } from "@opencoreagents/utils";
import { createHash } from "node:crypto";
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

interface FileIngestHashState {
  source: string;
  sourceHash: string;
  documentId: string;
  chunkCount: number;
}

const INGEST_HASH_SESSION_ID = "__rag_ingest_hash_state__";
const INGEST_HASH_MEMORY_TYPE_PREFIX = "ragIngestHash:";

function sha256Hex(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function sourceStateMemoryType(source: string): string {
  const key = createHash("sha256").update(source).digest("hex");
  return `${INGEST_HASH_MEMORY_TYPE_PREFIX}${key}`;
}

/**
 * Shared pipeline: resolve → parse → chunk → embed → upsert.
 * Used by `system_file_ingest` and `system_ingest_rag_source`.
 */
export async function runFileIngestPipeline(
  ctx: ToolContext,
  source: string,
  opts: FileIngestOptions = {},
): Promise<{
  success: true;
  documentId: string;
  chunksCreated: number;
  status: "completed" | "skipped_unchanged";
  sourceHash: string;
}> {
  const embedding = requireAdapter<EmbeddingAdapter>(ctx, "embeddingAdapter");
  const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");

  const resolved = await resolveSourceForTool(source, ctx);
  const sourceHash = sha256Hex(resolved.buffer);
  const hashScope = {
    projectId: ctx.projectId,
    agentId: ctx.agentId,
    sessionId: INGEST_HASH_SESSION_ID,
    endUserId: ctx.endUserId,
  };
  const hashMemoryType = sourceStateMemoryType(source);
  const existingRows = await ctx.memoryAdapter.query(hashScope, hashMemoryType);
  const existing = (existingRows.at(-1) ?? null) as FileIngestHashState | null;
  if (existing?.sourceHash === sourceHash) {
    return {
      success: true,
      documentId: existing.documentId,
      chunksCreated: 0,
      status: "skipped_unchanged",
      sourceHash,
    };
  }

  const parsed = await parseFile(resolved.buffer, resolved.mimeType);

  const strategy: ChunkOptions = {
    method: opts.chunkStrategy?.method ?? "recursive",
    maxTokens: opts.chunkStrategy?.maxTokens ?? 512,
    overlap: opts.chunkStrategy?.overlap ?? 50,
  };

  const chunks = chunkText(parsed.text, strategy);
  const texts = chunks.map((c) => c.content);
  const vectors = await embedding.embedBatch(texts);

  const documentId = `doc_${sourceHash.slice(0, 16)}`;
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

  await vector.delete(getVectorNamespace(ctx), { filter: { source } });
  await vector.upsert(getVectorNamespace(ctx), docs);
  await ctx.memoryAdapter.delete(hashScope, hashMemoryType);
  await ctx.memoryAdapter.save(hashScope, hashMemoryType, {
    source,
    sourceHash,
    documentId,
    chunkCount: chunks.length,
  } satisfies FileIngestHashState);

  return {
    success: true,
    documentId,
    chunksCreated: chunks.length,
    status: "completed",
    sourceHash,
  };
}
