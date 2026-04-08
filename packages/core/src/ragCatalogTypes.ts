/** Catalog entries for RAG tools (`AgentRuntime.registerRagCatalog`). */
export interface RagFileSourceEntry {
  /** Stable handle for tools (e.g. `handbook`). */
  id: string;
  /** Human-readable summary for the model and operators. */
  description: string;
  /**
   * Path relative to effective `fileReadRoot` (`Session.fileReadRoot` or `AgentRuntime` default), or http(s) URL when allowed
   * (same as `file_ingest` `source`).
   */
  source: string;
}

/** Validates runtime catalog entries (duplicate ids, required fields). */
export function validateRagFileCatalog(entries: readonly RagFileSourceEntry[]): void {
  const seen = new Set<string>();
  for (const raw of entries) {
    const id = raw.id?.trim();
    if (!id) throw new Error("RAG catalog: id is required");
    if (seen.has(id)) throw new Error(`RAG catalog: duplicate id: ${id}`);
    seen.add(id);
    const src = raw.source?.trim();
    if (!src) throw new Error(`RAG catalog: source is required for id ${id}`);
  }
}
