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
  /** Required for vector_search / vector_upsert / vector_delete tools. */
  embeddingAdapter?: EmbeddingAdapter;
  /** Required for vector_search / vector_upsert / vector_delete tools. */
  vectorAdapter?: VectorAdapter;
  /** Required for `wait`/`resume` in cluster deployments. See docs/core/19-cluster-deployment.md. */
  runStore?: RunStore;
  /** Required for send_message tool (multi-agent). */
  messageBus?: MessageBus;
  /**
   * Optional guard for `send_message` destinations (confused deputy / tenant policy).
   * Ignored when unset — only structural checks and self-send rejection apply.
   */
  sendMessageTargetPolicy?: SendMessageTargetPolicy;
  /**
   * Default base directory for `file_read` / `file_ingest` / RAG local paths when
   * {@link Session} omits `fileReadRoot`. Session value wins when set.
   */
  fileReadRoot?: string;
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
