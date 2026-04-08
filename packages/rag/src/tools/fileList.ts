import type { ToolAdapter, ToolContext, VectorAdapter } from "@agent-runtime/core";

function getVectorNamespace(ctx: ToolContext): string {
  const endUserId = (ctx as unknown as Record<string, unknown>).endUserId as string | undefined;
  return endUserId
    ? `${ctx.projectId}:${ctx.agentId}:eu:${endUserId}`
    : `${ctx.projectId}:${ctx.agentId}`;
}

function requireAdapter<T>(ctx: ToolContext, key: string): T {
  const adapter = (ctx as unknown as Record<string, unknown>)[key];
  if (!adapter) {
    throw new Error(`${key} is required for file_list.`);
  }
  return adapter as T;
}

export const fileListTool: ToolAdapter = {
  name: "file_list",
  description: "Lists documents that have been ingested into the knowledge base.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    };

    const vector = requireAdapter<VectorAdapter>(ctx, "vectorAdapter");
    const limit = o.limit ?? 20;

    const results = await vector.query(getVectorNamespace(ctx), {
      vector: [],
      topK: limit,
      filter: o.filter,
      includeMetadata: true,
    });

    const seen = new Map<string, Record<string, unknown>>();
    for (const r of results) {
      const docId = r.metadata?.documentId as string | undefined;
      if (docId && !seen.has(docId)) {
        seen.set(docId, {
          documentId: docId,
          source: r.metadata?.source,
          fileName: r.metadata?.fileName,
          mimeType: r.metadata?.mimeType,
        });
      }
    }

    const docs = [...seen.values()];
    const start = o.offset ?? 0;
    return {
      success: true,
      documents: docs.slice(start, start + limit),
      total: docs.length,
    };
  },
};

export const fileListDefinition = {
  id: "file_list",
  scope: "global" as const,
  description: fileListTool.description!,
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "object" },
      limit: { type: "number" },
      offset: { type: "number" },
    },
  },
};
