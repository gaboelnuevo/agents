# Messaging channels (WhatsApp, Telegram, etc.) — integration notes

**Brainstorm / design sketch.** How an external chat channel fits **`Session`**, **`Run`**, **`wait`/`resume`**, and what stays **outside** the engine. Complements [`07-multi-agent-rest-sessions.md`](./07-multi-agent-rest-sessions.md) and [`../core/14-consumers.md`](../core/14-consumers.md).

---

## 1. What the engine already gives you

- **`Session`**: correlation id (`sessionId`, `projectId`, optional `endUserId`) — not “chat history by session” in the LLM sense.
- **`Run`**: one execution with its own **`history`** (protocol steps). Each **`agent.run(userText)`** starts a **new** run unless you **`resume`** the same `runId` after a **`wait`**.
- **`ContextBuilder`**: builds LLM **`messages`** from **this run’s** `userInput` + `history` + optional `resumeMessages` — see [`../core/11-context-builder.md`](../core/11-context-builder.md).
- **`wait` / `resume`**: first-class pause; **`resume`** only when status is **`waiting`** (not after **`completed`**).

The core does **not** ship Meta/Telegram clients, webhooks, or send-message adapters; that is **host / product** code.

---

## 2. Minimal integration shape

1. **Webhook** (HTTPS) from the provider → verify signature / secret, parse payload (text, `chat_id`, ids).
2. **Stable mapping**: `provider + chat_id` → **`Session.id`** (store in your DB if you need persistence across deploys).
3. **Dispatch**:
   - If no run is **waiting** for this session → **`agent.run(incomingText)`** (new run).
   - If a run is **waiting** and you have the **`runId`** stored → **`agent.resume(runId, { type: "text", content })`** (or the payload shape you use).
4. **Outbound**: call **Telegram Bot API** / **WhatsApp Cloud API** (or BSP) with the final **`result`** text (or structured messages from your product).

---

## 3. Concurrent messages from the same user

Users can send several messages quickly; two overlapping **`agent.run()`** calls on the **same `Session`** create **two runs** with separate histories and can **race** on shared **memory** if you use **`MemoryAdapter`**.

**Recommended patterns**

| Pattern | Idea |
|--------|------|
| **Queue per chat** | FIFO keyed by `chat_id` / `sessionId`; one consumer processes **one** inbound message at a time for that conversation. Webhook returns **200 fast**; worker runs the engine. |
| **Lock per session** | Short Redis lock (`SET … NX`) around `run`/`resume` for that session; else re-enqueue or reject. |
| **Debounce / merge** | Optional: merge bursts within N ms into a single `userText` (product decision). |

**Anti-pattern for 1:1 chat**: parallel **`run()`** on the same session without ordering — unpredictable replies and memory races.

---

## 4. Async and provider timeouts

Webhook handlers should usually **ack immediately** and **enqueue** work. Long **`await agent.run()`** inside the webhook may hit **HTTP timeouts** on the provider side. Use a **queue + worker** pattern; align with [`../core/19-cluster-deployment.md`](../core/19-cluster-deployment.md) for multi-worker **`RunStore`**.

---

## 5. Conversation “memory” across messages

Each run’s LLM context is **that run’s** history. To feel like **one long chat** across many user messages you typically:

- **Multiple runs**, same **`Session`**, and use **memory tools** / **RAG** / **summarization** stored via **`MemoryAdapter`** or your DB; or
- **Custom** context injection (not the default MVP `ContextBuilder` behavior).

Explicitly **not** automatic: merging all past runs into one prompt without a policy.

---

## 6. How this differs from the Express example

[`examples/real-world-with-express/`](../../examples/real-world-with-express/) shows **HTTP + JSON + optional SSE**, **`InMemoryRunStore`**, and **`API_KEY`**. It is a **BFF reference**, not a WhatsApp/Telegram connector. The same **Session + Run + resume** semantics apply once your webhook calls **`Agent.load`** / **`run`** / **`resume`**.

---

## 7. Open product choices (not decided here)

- Idempotency keys for webhook retries (provider-specific message ids).
- Typing indicators, split bubbles, media (voice, images) — mapping to `userInput` or tools.
- Rate limits and abuse per `chat_id`.
- When a second message arrives while a run is **still running**: queue vs cancel vs merge.

---

## Related docs

- [`14-conversation-gateway-implementation-proposal.md`](./14-conversation-gateway-implementation-proposal.md) — **implementation proposal** (gateway, DTOs, idempotency, tests).
- [`04-protocol-communication-and-loop.md`](./04-protocol-communication-and-loop.md) — protocol and loop.
- [`../core/04-protocol.md`](../core/04-protocol.md) — step types.
- [`../core/11-context-builder.md`](../core/11-context-builder.md) — how LLM messages are assembled.
- [`../core/19-cluster-deployment.md`](../core/19-cluster-deployment.md) — **`RunStore`**, workers, sessions.
