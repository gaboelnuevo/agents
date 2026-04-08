import type { ToolAdapter, ToolContext } from "@agent-runtime/core";
import type { ChunkOptions } from "@agent-runtime/utils";
import { runFileIngestPipeline } from "./fileIngestCore.js";

export const fileIngestTool: ToolAdapter = {
  name: "file_ingest",
  description:
    "Ingests a file into the vector knowledge base. " +
    "Reads, splits into chunks, generates embeddings, and stores them. " +
    "Prefer ingest_rag_source when documents are registered in the RAG file catalog.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      source: string;
      chunkStrategy?: Partial<ChunkOptions>;
      metadata?: Record<string, unknown>;
    };
    return runFileIngestPipeline(ctx, o.source, {
      chunkStrategy: o.chunkStrategy,
      metadata: o.metadata,
    });
  },
};

export const fileIngestDefinition = {
  id: "file_ingest",
  scope: "global" as const,
  description: fileIngestTool.description!,
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "http(s) URL only with Session.allowHttpFileSources (optional host allowlist); " +
          "or local path relative to Session.fileReadRoot unless allowFileReadOutsideRoot",
      },
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
