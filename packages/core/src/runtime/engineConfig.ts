import type { LLMAdapter } from "../adapters/llm/LLMAdapter.js";
import type { MemoryAdapter } from "../adapters/memory/MemoryAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embedding/EmbeddingAdapter.js";
import type { VectorAdapter } from "../adapters/vector/VectorAdapter.js";
import type { RunStore } from "../adapters/run/RunStore.js";
import type { MessageBus } from "../bus/MessageBus.js";
import type { SendMessageTargetPolicy } from "../tools/sendMessagePolicy.js";

export interface EngineConfig {
  /**
   * Default LLM when `agent.llm.provider` has no entry in `llmAdaptersByProvider`.
   * Omit only if `llmAdaptersByProvider` covers every provider you use.
   */
  llmAdapter?: LLMAdapter;
  /**
   * One adapter per `agent.llm.provider` string (e.g. `"openai"`, `"anthropic"`).
   * Overrides `llmAdapter` when the key matches.
   */
  llmAdaptersByProvider?: Record<string, LLMAdapter>;
  memoryAdapter: MemoryAdapter;
  /** Required for system_vector_search / system_vector_upsert / system_vector_delete tools. */
  embeddingAdapter?: EmbeddingAdapter;
  /** Required for system_vector_search / system_vector_upsert / system_vector_delete tools. */
  vectorAdapter?: VectorAdapter;
  /** Required for `wait`/`resume` in cluster deployments. See docs/core/19-cluster-deployment.md. */
  runStore?: RunStore;
  /** Required for `system_send_message` tool (multi-agent). */
  messageBus?: MessageBus;
  /**
   * Optional guard for `system_send_message` destinations (confused deputy / tenant policy).
   * Ignored when unset — only structural checks and self-send rejection apply.
   */
  sendMessageTargetPolicy?: SendMessageTargetPolicy;
  /**
   * Default base directory for `system_file_read` / `system_file_ingest` / RAG local paths when
   * {@link Session} omits `fileReadRoot`. Session value wins when set.
   */
  fileReadRoot?: string;
  /**
   * Skill ids merged into **every** agent on this runtime when the engine builds deps
   * (`buildEngineDeps` / `RunBuilder`). Applied before the agent's own `skills`; duplicates are
   * dropped (first occurrence wins).
   */
  defaultSkillIdsGlobal?: readonly string[];
  /**
   * Extra tool allowlist for this runtime: intersected with the agent + skills allowlist.
   * Omit or `"*"` → no extra restriction (default).
   */
  allowedToolIds?: ReadonlySet<string> | readonly string[] | "*";
  maxIterations?: number;
  maxParseRecovery?: number;
  runTimeoutMs?: number;
  /** Per-tool wall-clock limit for `ToolRunner.execute` (optional). */
  toolTimeoutMs?: number;
  /**
   * **Optional.** When set, `AgentRuntime.dispatch` / `dispatchEngineJob` await
   * **`hydrateAgentDefinitionsFromStore`** from **`@opencoreagents/dynamic-definitions`** (runtime `import()`)
   * before **`Agent.load`**, using **`projectId`** and **`agentId`** from the job payload.
   * Omit for code-only agents (`Agent.define` at boot). Use e.g. **`RedisDynamicDefinitionsStore`**
   * (`@opencoreagents/adapters-redis`) or **`InMemoryDynamicDefinitionsStore`** (`@opencoreagents/dynamic-definitions`)
   * (hydration reads **`store.methods`** when the value is a facade).
   */
  dynamicDefinitionsStore?: unknown;
  /**
   * **Optional.** Used only when `dynamicDefinitionsStore` is set: supplies **`{{secret:*}}`** values
   * for HTTP tools during hydration. Omit or return **`{}`** if you do not use templated secrets.
   */
  dynamicDefinitionsSecrets?: () => Record<string, string>;
}

export const engineRuntimeDefaults = {
  maxIterations: 25,
  maxParseRecovery: 1,
  runTimeoutMs: 120_000,
};

export type ResolvedEngineConfig = EngineConfig & {
  maxIterations: number;
  maxParseRecovery: number;
  runTimeoutMs: number;
};

export function assertHasLlmConfig(merged: EngineConfig): void {
  if (merged.llmAdapter != null) return;
  const map = merged.llmAdaptersByProvider;
  if (map && Object.keys(map).some((k) => map[k] != null)) return;
  throw new Error(
    "AgentRuntime requires `llmAdapter` and/or a non-empty `llmAdaptersByProvider`.",
  );
}
