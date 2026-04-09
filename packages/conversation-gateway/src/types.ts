import type { AgentRuntime } from "@agent-runtime/core";

/** Inbound message after your webhook / SDK adapter (channel-agnostic). */
export interface NormalizedInboundMessage {
  conversationKey: string;
  text: string;
  externalMessageId: string;
  receivedAt: string;
  metadata?: Record<string, unknown>;
}

/** Sends the final user-visible text back through your transport. */
export interface OutboundDispatcher {
  sendReply(
    conversationKey: string,
    text: string,
    opts?: { runId: string },
  ): Promise<void>;
}

/** Resolves engine session ids for a stable conversation key. */
export type SessionResolver = (conversationKey: string) => {
  sessionId: string;
  projectId: string;
};

/**
 * Returns `runId` if this session has a **waiting** run for `agentId`, else `undefined`.
 * Often implemented via {@link findWaitingRunIdFromRunStore}.
 */
export type WaitingRunLookup = (
  sessionId: string,
  agentId: string,
) => Promise<string | undefined>;

export interface IdempotencyStore {
  seen(id: string): boolean;
  markProcessed(id: string): void;
}

export interface ConversationGatewayConfig {
  runtime: AgentRuntime;
  agentId: string;
  resolveSession: SessionResolver;
  findWaitingRunId: WaitingRunLookup;
  outbound: OutboundDispatcher;
  idempotency: IdempotencyStore;

  limits?: {
    maxTextLength?: number;
    maxInboundQueueDepthPerKey?: number;
  };

  batching?: {
    debounceMs: number;
    maxMessagesPerBatch: number;
    maxCharsPerBatch: number;
  } | null;

  hooks?: {
    onDiscard?: (reason: string, msg: NormalizedInboundMessage) => void;
    onError?: (error: unknown, msg: NormalizedInboundMessage) => void;
  };
}
