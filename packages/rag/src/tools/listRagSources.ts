import type { ToolAdapter, ToolContext } from "@agent-runtime/core";
import { resolveRagCatalog } from "../catalog.js";

export const listRagSourcesTool: ToolAdapter = {
  name: "list_rag_sources",
  description:
    "Lists documents that the app registered for RAG ingestion (id and description). " +
    "Use ingest_rag_source with an id from this list. Paths are server-defined, not chosen here.",
  async execute(_input: unknown, ctx: ToolContext): Promise<unknown> {
    const sources = resolveRagCatalog(ctx).map(({ id, description }) => ({ id, description }));
    return {
      success: true,
      sources,
      count: sources.length,
    };
  },
};

export const listRagSourcesDefinition = {
  id: "list_rag_sources",
  scope: "global" as const,
  description: listRagSourcesTool.description!,
  inputSchema: {
    type: "object",
    properties: {},
  },
  roles: ["agent"],
};
