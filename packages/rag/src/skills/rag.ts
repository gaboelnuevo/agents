import type { SkillDefinition } from "@agent-runtime/core";

export const ragSkill: SkillDefinition = {
  id: "rag",
  scope: "global",
  tools: [
    "vector_search",
    "vector_upsert",
    "vector_delete",
    "file_read",
    "file_ingest",
    "file_list",
  ],
  description:
    "Retrieval-Augmented Generation: search the knowledge base before answering, " +
    "ingest new documents, and manage stored fragments.",
};

export const ragReaderSkill: SkillDefinition = {
  id: "rag-reader",
  scope: "global",
  tools: ["vector_search"],
  description:
    "Search the knowledge base for relevant context before answering questions.",
};
