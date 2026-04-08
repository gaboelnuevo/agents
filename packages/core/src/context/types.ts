import type { AgentDefinition } from "../define/types.js";
import type { ToolAdapter } from "../adapters/tool/ToolAdapter.js";
import type { MemoryAdapter } from "../adapters/memory/MemoryAdapter.js";
import type { SecurityContext } from "../security/types.js";
import type { Session } from "../define/Session.js";
import type { Run } from "../protocol/types.js";
import type { LLMRequest } from "../adapters/llm/LLMAdapter.js";

export interface BuiltContext {
  messages: LLMRequest["messages"];
  tools?: LLMRequest["tools"];
  toolChoice?: LLMRequest["toolChoice"];
  responseFormat?: LLMRequest["responseFormat"];
}

export interface ContextBuilderInput {
  agent: AgentDefinition;
  run: Run;
  session: Session;
  memoryAdapter: MemoryAdapter;
  securityContext: SecurityContext;
  toolRegistry: Map<string, ToolAdapter>;
  /** Injected once when resuming a run after `wait` (see `executeRun` first turn). */
  resumeMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  recoveryMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}
