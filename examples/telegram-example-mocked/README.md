# Telegram (mocked) + ConversationGateway

Demonstrates the shape of a **Telegram Bot** integration **without** calling Telegram:

- **Inbound:** objects look like Telegram [`Update`](https://core.telegram.org/bots/api#update) / [`Message`](https://core.telegram.org/bots/api#message) JSON (private chat, text).
- **Normalize:** `telegramMessageToNormalized` → `NormalizedInboundMessage` (`conversationKey` = `telegram:chat:<chatId>`).
- **Engine:** `ConversationGateway` + mock LLM (`@agent-runtime/core`).
- **Outbound:** `MockTelegramClient` appends to an **outbox** instead of `POST`ing to `api.telegram.org`.

## Run

From repo root (after `pnpm install`):

```bash
pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/conversation-gateway
pnpm --filter @agent-runtime/example-telegram-mocked start
```

## Risks and gaps (real product)

This sample is intentionally minimal. Before production, account for:

| Topic | Issue | Mitigation |
|--------|--------|------------|
| **Edited messages** | `edited_message` reuses the same `message_id` as the original. Idempotency keys like `telegram:<chatId>:<messageId>` treat an edit as a **duplicate** and skip processing. | Decide product policy: ignore edits, or include `edit_date` / an `edit:` suffix in `externalMessageId` so edits are new work items. |
| **Session id shape** | `resolveSession` uses `sess-${conversationKey}` (e.g. colons in the string). | Fine for demos; if a downstream store forbids certain characters, hash or encode `conversationKey`. |
| **Runs stuck in `waiting`** | `ConversationGateway` still calls `outbound.sendReply` after `run`/`resume`; if the run ends in **`waiting`** without a `result` step, reply text can be **empty** — a real bot might still call **`sendMessage`** with `""`. | Skip outbound when there is nothing user-visible, or branch on `run.status` in your adapter (extend or wrap the gateway). |
| **In-memory idempotency** | The example uses a `Set` in one process. | Use Redis / DB with an **atomic claim** (see doc §5.6) when multiple workers handle the same bot. |
| **Concurrency** | The script processes one update at a time; real traffic can deliver **overlapping** updates for the same chat. | **Serialize** `handleInbound` per `conversationKey` (FIFO queue or lock); see [§5.1–5.6 in the gateway proposal](../../docs/brainstorm/14-conversation-gateway-implementation-proposal.md). |

## Production checklist

- Verify webhook signatures (`X-Telegram-Bot-Api-Secret-Token` or custom secret).
- Replace in-memory idempotency with **Redis** / DB (atomic claim) for multi-worker setups.
- Serialize **`handleInbound`** per `conversationKey` (queue or lock); see [`docs/brainstorm/14-conversation-gateway-implementation-proposal.md`](../../docs/brainstorm/14-conversation-gateway-implementation-proposal.md) §5.
- Implement real **`sendMessage`** with your bot token and handle rate limits / retries.
