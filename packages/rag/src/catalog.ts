/**
 * Process-global catalog (legacy). Prefer **`registerRagCatalog(runtime, projectId, …)`** from this package
 * (or **`AgentRuntime.registerRagCatalog`** directly) per project.
 * Tools call {@link resolveRagCatalog} / {@link resolveRagSource} which prefer `ToolContext.ragFileCatalog`.
 */
import type { AgentRuntime, RagFileSourceEntry, ToolContext } from "@agent-runtime/core";

export type RagSourceDefinition = RagFileSourceEntry;

/**
 * Registers the per-project RAG file catalog on {@link AgentRuntime}.
 * Same behavior as **`runtime.registerRagCatalog(projectId, sources)`** — use this entry point so catalog
 * registration stays discoverable under **`@agent-runtime/rag`**.
 *
 * Call **`registerRagToolsAndSkills()`** first; otherwise a dev **`console.warn`** may run (see core).
 */
export function registerRagCatalog(
  runtime: AgentRuntime,
  projectId: string,
  sources: ReadonlyArray<RagSourceDefinition>,
): void {
  runtime.registerRagCatalog(projectId, sources);
}

const byId = new Map<string, RagSourceDefinition>();

/**
 * Replace the process-global catalog (used when `ToolContext.ragFileCatalog` is unset).
 * For production, prefer **`registerRagCatalog(runtime, session.projectId, entries)`** (this package).
 */
export function registerRagFileCatalog(sources: RagSourceDefinition[]): void {
  byId.clear();
  for (const raw of sources) {
    const id = raw.id?.trim();
    if (!id) throw new Error("RagSourceDefinition.id is required");
    if (byId.has(id)) throw new Error(`Duplicate RAG catalog id: ${id}`);
    byId.set(id, {
      id,
      description: raw.description?.trim() || raw.description,
      source: raw.source.trim(),
    });
  }
}

export function getRagFileCatalog(): RagSourceDefinition[] {
  return [...byId.values()];
}

export function getRagSourceById(id: string): RagSourceDefinition | undefined {
  return byId.get(id.trim());
}

function normalizeEntry(raw: RagFileSourceEntry): RagSourceDefinition {
  return {
    id: raw.id.trim(),
    description: raw.description?.trim() || raw.description,
    source: raw.source.trim(),
  };
}

/** Prefer `ctx.ragFileCatalog` (per-project runtime catalog); otherwise the global map from {@link registerRagFileCatalog}. */
export function resolveRagCatalog(ctx: ToolContext): RagSourceDefinition[] {
  if (ctx.ragFileCatalog !== undefined) {
    return ctx.ragFileCatalog.map(normalizeEntry);
  }
  return getRagFileCatalog();
}

/** Prefer `ctx.ragFileCatalog`; otherwise {@link getRagSourceById}. */
export function resolveRagSource(ctx: ToolContext, id: string): RagSourceDefinition | undefined {
  const key = id.trim();
  if (ctx.ragFileCatalog !== undefined) {
    for (const raw of ctx.ragFileCatalog) {
      if (raw.id.trim() === key) return normalizeEntry(raw);
    }
    return undefined;
  }
  return getRagSourceById(key);
}

/** @internal */
export function __resetRagFileCatalogForTests(): void {
  byId.clear();
}
