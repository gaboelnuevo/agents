import type { LLMAdapter } from "../adapters/llm/LLMAdapter.js";
import type { MemoryAdapter } from "../adapters/memory/MemoryAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embedding/EmbeddingAdapter.js";
import type { VectorAdapter } from "../adapters/vector/VectorAdapter.js";
import type { RunStore } from "../adapters/run/RunStore.js";
import type { MessageBus } from "../bus/MessageBus.js";
import { registerBuiltinToolHandlers } from "../tools/builtins.js";
import { registerVectorToolHandlers } from "../tools/vectorTools.js";
import { registerSendMessageToolHandler } from "../tools/sendMessage.js";

export interface EngineConfig {
  llmAdapter: LLMAdapter;
  memoryAdapter: MemoryAdapter;
  /** Required for vector_search / vector_upsert / vector_delete tools. */
  embeddingAdapter?: EmbeddingAdapter;
  /** Required for vector_search / vector_upsert / vector_delete tools. */
  vectorAdapter?: VectorAdapter;
  /** Required for `wait`/`resume` in cluster deployments. See docs/core/19-cluster-deployment.md. */
  runStore?: RunStore;
  /** Required for send_message tool (multi-agent). */
  messageBus?: MessageBus;
  maxIterations?: number;
  maxParseRecovery?: number;
  runTimeoutMs?: number;
  /** Per-tool wall-clock limit for `ToolRunner.execute` (optional). */
  toolTimeoutMs?: number;
}

const defaults = {
  maxIterations: 25,
  maxParseRecovery: 1,
  runTimeoutMs: 120_000,
};

/**
 * Process-local singleton. Each worker in a cluster must call
 * `configureRuntime()` independently with identical adapter references
 * (pointing to shared infrastructure like Redis).
 *
 * See docs/core/19-cluster-deployment.md §2.
 */
let config: (EngineConfig & typeof defaults) | null = null;

export function configureRuntime(partial: EngineConfig): void {
  registerBuiltinToolHandlers();
  if (partial.embeddingAdapter && partial.vectorAdapter) {
    registerVectorToolHandlers();
  }
  if (partial.messageBus) {
    registerSendMessageToolHandler();
  }
  config = { ...defaults, ...partial };
}

export function getEngineConfig(): EngineConfig & typeof defaults {
  if (!config) {
    throw new Error(
      "configureRuntime({ llmAdapter, memoryAdapter }) must be called before Agent.load or Tool usage in production.",
    );
  }
  return config;
}

/** @internal tests only */
export function __resetRuntimeConfigForTests(): void {
  config = null;
}
