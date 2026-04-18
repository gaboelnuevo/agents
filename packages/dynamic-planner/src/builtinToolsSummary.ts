/** Shown by `list_available_tools` alongside HTTP tools from the definitions snapshot. */
export const DEFAULT_BUILTIN_TOOLS_FOR_LISTING: readonly {
  id: string;
  description: string;
  type: "builtin";
}[] = [
  { id: "system_get_memory", description: "Read session or long-term memory", type: "builtin" },
  { id: "system_save_memory", description: "Write session or long-term memory", type: "builtin" },
  { id: "system_write_artifact", description: "Write an artifact file to runtime storage", type: "builtin" },
  { id: "system_vector_search", description: "Semantic search over knowledge base", type: "builtin" },
  { id: "system_file_ingest", description: "Index a file into the vector store", type: "builtin" },
  { id: "system_send_message", description: "Send a message to another agent", type: "builtin" },
];
