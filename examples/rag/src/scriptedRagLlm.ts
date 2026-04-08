/**
 * **Demo only.** Fixed steps: `ingest_rag_source` → `vector_search` → `result` (no API keys).
 *
 * **Production:** use a real `LLMAdapter`; the model calls `list_rag_sources` / `ingest_rag_source` /
 * `vector_search` based on tool schemas. Catalog: **`registerRagCatalog(runtime, projectId, …)`** (or legacy **`registerRagFileCatalog`**) — independent of which LLM you use.
 *
 * @see [`examples/openai-tools-skill`](../../openai-tools-skill/) for **`OpenAILLMAdapter`** without a wrapper.
 */
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";

export interface ScriptedRagLlmOptions {
  /** Must match a catalog entry id for the agent’s project (`registerRagCatalog` or global register). */
  catalogIngestId: string;
  searchQuery: string;
}

/** @see module docstring — replace with a real {@link LLMAdapter} in production. */
export function createScriptedRagLlm(opts: ScriptedRagLlmOptions): LLMAdapter {
  const { catalogIngestId, searchQuery } = opts;
  let step = 0;
  return {
    async generate(_req: LLMRequest): Promise<LLMResponse> {
      switch (step++) {
        case 0:
          return {
            content: JSON.stringify({
              type: "action",
              tool: "ingest_rag_source",
              input: { id: catalogIngestId },
            }),
          };
        case 1:
          return {
            content: JSON.stringify({
              type: "action",
              tool: "vector_search",
              input: { query: searchQuery, topK: 5 },
            }),
          };
        default:
          return {
            content: JSON.stringify({
              type: "result",
              content:
                "Answer (demo): The retrieved chunks describe RAG, catalog ingest, vector_search, " +
                "and using a real embedding API plus a hosted vector index in production.",
            }),
          };
      }
    },
  };
}
