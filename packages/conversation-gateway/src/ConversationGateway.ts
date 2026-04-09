import { Agent, Session, type Run } from "@agent-runtime/core";
import type { ConversationGatewayConfig, NormalizedInboundMessage } from "./types.js";
import { replyTextFromRun } from "./replyText.js";

export class ConversationGateway {
  constructor(private readonly cfg: ConversationGatewayConfig) {}

  /**
   * Call from your queue worker or after webhook ack — not inside a slow HTTP handler.
   * Serialize per `conversationKey` in production (see docs/brainstorm/14-conversation-gateway-implementation-proposal.md §5).
   */
  async handleInbound(msg: NormalizedInboundMessage): Promise<void> {
    const { limits, idempotency, hooks, agentId, runtime, resolveSession, findWaitingRunId, outbound } =
      this.cfg;

    if (idempotency.seen(msg.externalMessageId)) return;

    const maxLen = limits?.maxTextLength;
    if (maxLen != null && msg.text.length > maxLen) {
      hooks?.onDiscard?.("text_too_long", msg);
      return;
    }

    idempotency.markProcessed(msg.externalMessageId);

    const { sessionId, projectId } = resolveSession(msg.conversationKey);
    const session = new Session({ id: sessionId, projectId });
    const agent = await Agent.load(agentId, runtime, { session });

    try {
      const waitingRunId = await findWaitingRunId(sessionId, agentId);

      const run: Run = waitingRunId
        ? await agent.resume(waitingRunId, { type: "text", content: msg.text })
        : await agent.run(msg.text);

      const text = replyTextFromRun(run);

      await outbound.sendReply(msg.conversationKey, text, {
        runId: run.runId,
      });
    } catch (e) {
      hooks?.onError?.(e, msg);
      throw e;
    }
  }
}
