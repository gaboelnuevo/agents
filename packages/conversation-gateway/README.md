# @opencoreagents/conversation-gateway

Channel-agnostic **inbound message → `Agent.run` / `resume` → outbound reply** orchestration.

- **`ConversationGateway`** — load agent, resolve session, choose run vs resume, extract reply text, call **`OutboundDispatcher`**.
- **`findWaitingRunIdFromRunStore`** — optional helper implementing **`findWaitingRunId`** with a **`RunStore`**, using session-scoped queries when available.

Design and concurrency notes: [`docs/brainstorm/14-conversation-gateway-implementation-proposal.md`](../../docs/brainstorm/14-conversation-gateway-implementation-proposal.md).

**Not included:** per-`conversationKey` serialization, debounce batching, or distributed idempotency — implement those in your host (queue, Redis, etc.).
