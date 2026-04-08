import type { MemoryAdapter } from "../memory/MemoryAdapter.js";
import type { SecurityContext } from "../../security/types.js";
import type { MessageBus } from "../../bus/MessageBus.js";
import type { SendMessageTargetPolicy } from "../../tools/sendMessagePolicy.js";
import type { RagFileSourceEntry } from "../../ragCatalogTypes.js";

export interface ToolContext {
  projectId: string;
  agentId: string;
  runId: string;
  sessionId: string;
  endUserId?: string;
  memoryAdapter: MemoryAdapter;
  securityContext: SecurityContext;
  /** Effective sandbox root: session overrides `AgentRuntime` config (see {@link buildEngineDeps}). */
  fileReadRoot?: string;
  /** Copied from {@link Session.allowFileReadOutsideRoot}. */
  allowFileReadOutsideRoot?: boolean;
  /** Copied from {@link Session.allowHttpFileSources}. */
  allowHttpFileSources?: boolean;
  /** Copied from {@link Session.httpFileSourceHostsAllowlist}. */
  httpFileSourceHostsAllowlist?: string[];
  /** Set when {@link AgentRuntime} provides `messageBus` (e.g. for `send_message`). */
  messageBus?: MessageBus;
  /** From {@link AgentRuntime} `sendMessageTargetPolicy` when set. */
  sendMessageTargetPolicy?: SendMessageTargetPolicy;
  /** Per-project RAG catalog from `AgentRuntime` when `registerRagCatalog` was called for `session.projectId`. */
  ragFileCatalog?: ReadonlyArray<RagFileSourceEntry>;
}

export interface ToolAdapter {
  name: string;
  description?: string;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
  validate?(input: unknown): boolean;
}

export interface ObservationContent {
  success: boolean;
  data?: unknown;
  error?: string;
}
