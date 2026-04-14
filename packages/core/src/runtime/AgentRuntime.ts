import { registerBuiltinToolHandlers } from "../tools/builtins.js";
import { registerVectorToolHandlers } from "../tools/vectorTools.js";
import { registerSendMessageToolHandler } from "../tools/sendMessage.js";
import { dispatchEngineJob } from "../engine/dispatchJob.js";
import type { EngineJobPayload } from "../engine/engineJobPayload.js";
import {
  type EngineConfig,
  type ResolvedEngineConfig,
  assertHasLlmConfig,
  engineRuntimeDefaults,
} from "./engineConfig.js";
import type { RagFileSourceEntry } from "../ragCatalogTypes.js";
import { validateRagFileCatalog } from "../ragCatalogTypes.js";
import { resolveToolRegistry } from "../define/registry.js";
import type { Run } from "../protocol/types.js";

function ragCatalogToolsLookRegistered(): boolean {
  return resolveToolRegistry("").has("system_list_rag_sources");
}

function shouldEmitRagCatalogDevWarning(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "test" &&
    process.env.VITEST !== "true"
  );
}

function applyEngineBootstrap(partial: EngineConfig): void {
  registerBuiltinToolHandlers();
  if (partial.embeddingAdapter && partial.vectorAdapter) {
    registerVectorToolHandlers();
  }
  if (partial.messageBus) {
    registerSendMessageToolHandler();
  }
}

function normalizeRagEntries(
  sources: ReadonlyArray<RagFileSourceEntry>,
): RagFileSourceEntry[] {
  return sources.map((raw) => ({
    id: raw.id.trim(),
    description: raw.description?.trim() || raw.description,
    source: raw.source.trim(),
  }));
}

/**
 * Holds engine adapters and limits for **`Agent.load`** / **`RunBuilder`**.
 * Create one (or one per worker) and pass it explicitly — there is no global runtime singleton.
 *
 * Optional **`allowedToolIds`** on {@link EngineConfig} intersects with each agent’s tool list;
 * omit it or pass `"*"` for no extra restriction.
 *
 * Optional **`defaultSkillIdsGlobal`** prepends skill ids when the engine builds deps
 * (`buildEngineDeps` / `RunBuilder`), before each agent's own `skills`.
 *
 * RAG file catalogs are per **`projectId`**: call **`registerRagCatalog(projectId, entries)`** (or
 * **`registerRagCatalog(runtime, projectId, entries)`** from **`@opencoreagents/rag`**) so
 * `system_list_rag_sources` / `system_ingest_rag_source` use that list for sessions in that project; if a project
 * was never registered, tools fall back to the process-global map in `@opencoreagents/rag`.
 */
export class AgentRuntime {
  private readonly _config: ResolvedEngineConfig;
  private readonly _ragCatalogByProject = new Map<string, RagFileSourceEntry[]>();
  private _warnedMissingRagTools = false;

  constructor(partial: EngineConfig) {
    applyEngineBootstrap(partial);
    const merged: ResolvedEngineConfig = { ...engineRuntimeDefaults, ...partial };
    assertHasLlmConfig(merged);
    this._config = merged;
  }

  /** Merged config including iteration/timeout defaults. */
  get config(): Readonly<ResolvedEngineConfig> {
    return this._config;
  }

  /**
   * Registers the RAG file catalog for a **project** (`Session.projectId` / agent `projectId`).
   * Replaces any previous catalog for that project. Pass **`[]`** to pin the project to an empty catalog
   * (tools will not fall back to the global `registerRagFileCatalog` map for that project).
   *
   * **Order:** register RAG tools first (e.g. `registerRagToolsAndSkills()` from `@opencoreagents/rag`),
   * then call this — otherwise a **console warning** is emitted once per runtime (skipped under test).
   */
  registerRagCatalog(
    projectId: string,
    sources: ReadonlyArray<RagFileSourceEntry>,
  ): void {
    const pid = projectId.trim();
    if (!pid) throw new Error("registerRagCatalog: projectId is required");
    if (
      !this._warnedMissingRagTools &&
      shouldEmitRagCatalogDevWarning() &&
      !ragCatalogToolsLookRegistered()
    ) {
      this._warnedMissingRagTools = true;
      console.warn(
        "[AgentRuntime] registerRagCatalog: `system_list_rag_sources` is not registered yet. " +
          "Call `registerRagToolsAndSkills()` from `@opencoreagents/rag` (or register RAG tools) before `registerRagCatalog` to avoid this warning and ensure catalog tools run.",
      );
    }
    validateRagFileCatalog(sources);
    this._ragCatalogByProject.set(pid, normalizeRagEntries(sources));
  }

  /**
   * Returns the RAG catalog for **`projectId`** if {@link registerRagCatalog} was called for it
   * (including when registered with an empty array). Otherwise **`undefined`** (tools use legacy global catalog).
   */
  ragCatalogForProject(projectId: string): ReadonlyArray<RagFileSourceEntry> | undefined {
    const pid = projectId.trim();
    if (!this._ragCatalogByProject.has(pid)) return undefined;
    return this._ragCatalogByProject.get(pid)!;
  }

  /**
   * Same as {@link dispatchEngineJob}(this, payload) — `Agent.load` → `run` or `resume` for one job payload
   * (e.g. from BullMQ). When **`config.dynamicDefinitionsStore`** is set, dispatch hydrates from the store first.
   */
  dispatch(payload: EngineJobPayload): Promise<Run> {
    return dispatchEngineJob(this, payload);
  }
}
