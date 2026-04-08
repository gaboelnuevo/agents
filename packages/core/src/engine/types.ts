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
import type { SendMessageTargetPolicy } from "../tools/sendMessagePolicy.js";
import type { RagFileSourceEntry } from "../ragCatalogTypes.js";

export type { ContextBuilderInput, BuiltContext } from "../context/types.js";

export interface EngineDeps {
  agent: AgentDefinition;
  session: Session;
  /**
   * Effective file sandbox root: `session.fileReadRoot ?? runtime.config.fileReadRoot`.
   * Set by {@link buildEngineDeps}; omit only when assembling deps manually.
   */
  fileReadRoot?: string;
  memoryAdapter: MemoryAdapter;
  llmAdapter: LLMAdapter;
  embeddingAdapter?: EmbeddingAdapter;
  vectorAdapter?: VectorAdapter;
  messageBus?: MessageBus;
  sendMessageTargetPolicy?: SendMessageTargetPolicy;
  /** From `AgentRuntime.registerRagCatalog(session.projectId, …)` when set (including `[]`). */
  ragFileCatalog?: ReadonlyArray<RagFileSourceEntry>;
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

/** Set after each `generate` + `parseStep` attempt — use for billing / wasted-token metrics. */
export type LLMParseOutcome =
  | "parsed"
  | "parse_failed_recoverable"
  | "parse_failed_fatal";

export interface EngineHooks {
  onThought?: (step: Step) => void;
  onAction?: (step: Step) => void;
  onObservation?: (observation: unknown) => void;
  onWait?: (step: Step) => void;
  /** Fires immediately after each LLM `generate`, before validation. */
  onLLMResponse?: (response: LLMResponse, meta: LLMResponseMeta) => void;
  /**
   * Fires after `parseStep` for that response. **`parse_failed_*`** means the model output did not
   * yield a valid step (tokens often counted as **wasted** for billing). See {@link watchUsage}.
   */
  onLLMAfterParse?: (
    response: LLMResponse,
    meta: LLMResponseMeta,
    outcome: LLMParseOutcome,
  ) => void;
}

export type { LLMRequest, LLMResponse };
