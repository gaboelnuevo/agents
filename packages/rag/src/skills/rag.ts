import type { SkillDefinition } from "@agent-runtime/core";

export const ragSkill: SkillDefinition = {
  id: "rag",
  scope: "global",
  tools: [
    "list_rag_sources",
    "ingest_rag_source",
    "vector_search",
    "vector_upsert",
    "vector_delete",
    "file_read",
    "file_ingest",
    "file_list",
  ],
  description:
    "Retrieval-Augmented Generation: list and ingest preregistered sources, search the knowledge base, " +
    "and manage stored fragments.",
};

export const ragReaderSkill: SkillDefinition = {
  id: "rag-reader",
  scope: "global",
  tools: ["list_rag_sources", "vector_search"],
  description:
    "List registered RAG sources (id + description) and search the knowledge base for context.",
};
