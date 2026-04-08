import type { ToolAdapter, ToolContext } from "@agent-runtime/core";
import type { ChunkOptions } from "@agent-runtime/utils";
import { resolveRagSource } from "../catalog.js";
import { runFileIngestPipeline } from "./fileIngestCore.js";

export const ingestRagSourceTool: ToolAdapter = {
  name: "ingest_rag_source",
  description:
    "Ingests a preregistered catalog document into the vector store by id. " +
    "Call list_rag_sources first if you do not know valid ids.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      id: string;
      chunkStrategy?: Partial<ChunkOptions>;
      metadata?: Record<string, unknown>;
    };
    const entry = resolveRagSource(ctx, o.id);
    if (!entry) {
      return {
        success: false,
        error: `Unknown RAG catalog id: ${o.id}. Call list_rag_sources.`,
      };
    }
    return runFileIngestPipeline(ctx, entry.source, {
      chunkStrategy: o.chunkStrategy,
      metadata: {
        ...o.metadata,
        ragCatalogId: entry.id,
        ragCatalogDescription: entry.description,
      },
    });
  },
};

export const ingestRagSourceDefinition = {
  id: "ingest_rag_source",
  scope: "global" as const,
  description: ingestRagSourceTool.description!,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Catalog id from list_rag_sources",
      },
      chunkStrategy: {
        type: "object",
        properties: {
          method: { enum: ["fixed_size", "sentence", "paragraph", "recursive"] },
          maxTokens: { type: "number" },
          overlap: { type: "number" },
        },
      },
      metadata: { type: "object", description: "Extra metadata merged into chunk metadata" },
    },
    required: ["id"],
  },
  roles: ["admin", "operator"],
};
