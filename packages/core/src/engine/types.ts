import type { LLMAdapter, LLMRequest, LLMResponse } from "../adapters/llm/LLMAdapter.js";
import type { MemoryAdapter } from "../adapters/memory/MemoryAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embedding/EmbeddingAdapter.js";
import type { VectorAdapter } from "../adapters/vector/VectorAdapter.js";
import type { ToolAdapter } from "../adapters/tool/ToolAdapter.js";
import type { SecurityContext } from "../security/types.js";
import type { Session } from "../define/Session.js";
import type { Step } from "../protocol/types.js";
import type { BuiltContext, ContextBuilderInput } from "../context/types.js";
import type { AgentDefinition } from "../define/types.js";
import type { MessageBus } from "../bus/MessageBus.js";

export type { ContextBuilderInput, BuiltContext } from "../context/types.js";

export interface EngineDeps {
  agent: AgentDefinition;
  session: Session;
  memoryAdapter: MemoryAdapter;
  llmAdapter: LLMAdapter;
  embeddingAdapter?: EmbeddingAdapter;
  vectorAdapter?: VectorAdapter;
  messageBus?: MessageBus;
  toolRunner: import("../tools/ToolRunner.js").ToolRunner;
  toolRegistry: Map<string, ToolAdapter>;
  contextBuilder: {
    build(input: ContextBuilderInput): Promise<BuiltContext>;
  };
  securityContext: SecurityContext;
  limits: {
    maxIterations: number;
    maxParseRecovery: number;
    runTimeoutMs: number;
    /** When set, each tool `execute` is bounded by `Promise.race` (does not abort the underlying work). */
    toolTimeoutMs?: number;
  };
  signal?: AbortSignal;
  hooks?: EngineHooks;
  /** ISO timestamp when run started (timeout). */
  startedAtMs: number;
  /** First LLM turn only — user/assistant messages after a `wait` resume. */
  resumeMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface LLMResponseMeta {
  agentId: string;
  runId: string;
}

export interface EngineHooks {
  onThought?: (step: Step) => void;
  onAction?: (step: Step) => void;
  onObservation?: (observation: unknown) => void;
  onWait?: (step: Step) => void;
  onLLMResponse?: (response: LLMResponse, meta: LLMResponseMeta) => void;
}

export type { LLMRequest, LLMResponse };
