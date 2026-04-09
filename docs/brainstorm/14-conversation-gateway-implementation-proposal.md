# Implementation proposal — Conversation Gateway (channel-agnostic)

**Brainstorm / implementation sketch.** How to encapsulate external integration without coupling the product to a specific vendor. Complements [`13-canales-mensajeria-integracion.md`](./13-canales-mensajeria-integracion.md) (problem and context) and consumers in [`../core/14-consumers.md`](../core/14-consumers.md).

---

## 1. Goal

A **single domain component** that:

- Accepts **already normalized** messages (no knowledge of vendor HTTP or proprietary formats).
- Resolves **`Session`** and chooses **`run`** vs **`resume`** from run state and product policy.
- Optionally **serializes** work per conversation (queue / lock).
- Emits **outbound** replies through a **decoupled port** (each implementation talks to the real API).

The **`AgentRuntime`** engine does not change: it is only invoked from this layer.

---

## 2. Recommended names (neutral)

| Role | Suggested name | Responsibility |
|------|----------------|----------------|
| Orchestrator | **`ConversationGateway`** or **`InboundMessageProcessor`** | Entry point after normalization; calls `Agent.load`, `run`, `resume`. |
| Outbound | **`OutboundDispatcher`** (interface) | `sendReply(conversationKey, payload)` — concrete implementations per transport. |
| Normalization | *Adapters* per source | Webhook / SDK → **`NormalizedInboundMessage`** (internal DTO). |

Avoid vendor- or single-channel-specific terms in the generic core.

---

## 3. Minimal contracts (conceptual)

### 3.1 Normalized inbound

**`NormalizedInboundMessage`** (illustrative name):

- **`conversationKey`**: stable string identifying the logical thread (1:1 or group), derived in your mapping layer.
- **`text`**: main turn content (extend later to `parts` if you add media).
- **`externalMessageId`**: provider id for **idempotency** (avoid double processing on webhook retries).
- **`receivedAt`**: instant (ISO or ms).
- **`metadata`**: optional `Record<string, unknown>` — for adapters only (not required by the gateway).

### 3.2 Session resolution

**`resolveSession(conversationKey)`** → `{ sessionId, projectId, … }` according to your model (table, deterministic hash, etc.).

### 3.3 Run vs resume routing

Example product rule:

- If there is a run in **`waiting`** for that **session** + target **agent** and you have persisted **`runId`** → **`agent.resume(runId, input)`**.
- Otherwise → **`agent.run(text)`** (new run).

The lookup can use a filtered **`RunStore`**, or an auxiliary table **`active_wait_by_session`** if you need more control.

### 3.4 Outbound

**`OutboundMessage`** (illustrative name):

- **`conversationKey`** (or ids already resolved by the outbound adapter).
- **`text`** or minimal agreed payload.
- Optional: **`runId`**, **`correlationId`** for tracing.

---

## 4. End-to-end flow

```
[Source adapter]  →  NormalizedInboundMessage
        ↓
[Optional queue / lock per conversationKey]
        ↓
ConversationGateway
        → resolveSession
        → run | resume  (Agent.load + engine)
        ↓
OutboundDispatcher  →  [Destination adapter]
```

- **HTTP webhook**: respond **quickly** (200) and enqueue if work is long; see [`13`](./13-canales-mensajeria-integracion.md) §4.

---

## 5. Concurrency per conversation

| Strategy | Use |
|----------|-----|
| **FIFO queue per `conversationKey`** | One consumer processes one message at a time per thread; avoids overlapping `run()` on the same session. |
| **Distributed lock** (e.g. Redis `SET key NX EX …`) | Lighter alternative if you already have the infra. |
| **Debounce / merge** | Optional: merge bursts into a single `text` (explicit product rule). |

Without serialization, two simultaneous messages from the same user produce **two runs** and possible **races** on session-scoped shared memory.

### 5.1 When to **block** the next message (strict serialization)

Apply **one-in-flight per `conversationKey`** (queue or mutex) when:

- **`MemoryAdapter`** (or any session-scoped store) can be updated by the agent — two concurrent **`run()`** calls on the same **`Session`** can **race** and corrupt ordering of reads/writes.
- You must guarantee **order**: reply A is fully computed and persisted before processing message B (typical 1:1 support bots).
- A run may end in **`wait`** — the next user line might need **`resume`**; if another **`run()`** started in parallel, routing breaks. Serialization keeps **at most one** active run per conversation unless your product explicitly allows parallel runs (rare).

**Semantics**: message *n+1* is not handed to **`handleInbound`** until message *n*’s **`handleInbound`** promise settles (success or failure). Implement with a **FIFO queue** per key or a **re-entrant lock** around the gateway call.

### 5.2 When to **batch** (merge multiple messages into one processing unit)

**Batching** means: several inbound events → **one** **`agent.run(text)`** (or one concatenated user turn), instead of one run per webhook.

Use it when:

- The product allows **“burst collapse”** (e.g. user sends 3 short lines in 500 ms and you want a **single** model call).
- **Cost/latency**: fewer LLM calls matters more than one reply per inbound id.
- There is **no** strict **audit requirement** of one outbound reply per **external message id**.

**Typical pattern**: **debounce window** — append texts to a buffer keyed by `conversationKey`; **flush** when:

- **Idle**: no new message for **T** ms (e.g. 300–800 ms), or
- **Cap**: **K** messages or **M** characters, or
- **Deadline**: max wait **T_max** even if still receiving (avoid starvation).

Flush = one **`NormalizedInboundMessage`** with `text` built from merged lines (e.g. joined with `\n`), and **idempotency** keyed by a **synthetic batch id** or by marking **all** merged `externalMessageId`s as consumed in one transaction.

### 5.3 When **not** to batch

- **Compliance / ticketing**: one ticket row per inbound message — keep **one run per message** (still serialize if needed).
- **`wait` / `resume`**: the second message might be the **resume** payload, not part of the same “user ramble” as the first — **do not** merge across **wait** boundaries; flush the batch **before** a run enters **`waiting`**, and after resume process **only** the resume path (often a **single** text).
- **Provider retries**: merging can duplicate content if retries overlap the window — tie batching to **deduped** ids.

### 5.4 Recommended default

| Mode | Policy |
|------|--------|
| **Default (safest)** | **Serialize** per `conversationKey`; **no** batching until you measure need. |
| **High-traffic chat** | Serialize + **optional** debounce merge **only** for messages that arrive **before** any run starts (same window), **never** merging across **`wait`**. |
| **Resume-heavy flows** | Strict serialization; batching **off** or limited to pre-wait bursts only. |

### 5.5 When to **discard** an inbound message (drop, no `run` / no `resume`)

**Discard** = accept at the edge (HTTP 200 / ack to provider) but **do not** call **`handleInbound`** for the engine, or exit before **`agent.run`**. Log/metric the reason.

| Situation | Typical action |
|-----------|----------------|
| **Duplicate idempotency key** | **`externalMessageId`** already processed — **silent discard** (still idempotent for the provider). See §6. |
| **Validation failure** | Missing `conversationKey`, empty `text` when required, malformed payload after adapter parse — discard + **structured log**; optional DLQ for inspection. |
| **Size / policy limits** | Message or attachment exceeds max length — discard or **truncate** (product rule); document whether you notify the user outbound. |
| **Rate limit / abuse** | Per `conversationKey` or per user — **throttle**: drop excess with 429 at HTTP layer, or enqueue “overflow” with lower priority; do not starve the engine. |
| **Unknown or blocked session** | `resolveSession` returns no row / tenant banned — discard + audit log (avoid leaking existence in outbound text). |
| **Stale / replay window** | Optional: drop events older than **T** (clock skew, replay attacks) if your provider exposes a server timestamp. |
| **Unsupported type** | e.g. only `text` supported today — inbound sticker/voice without STT: discard or reply once with “unsupported” via **outbound** (that second path is **not** discard). |
| **Queue backpressure** | If the per-key queue exceeds max depth, **drop newest**, **drop oldest**, or **shed** to dead-letter — explicit policy to avoid unbounded memory. |

**Do not** confuse discard with **serialization**: a serialized queue **delays** processing; **discard** **skips** processing for that event (except duplicates, where skip is correct).

**Observability**: metric `inbound_discarded_total{reason=…}` so you can tune limits and fix adapters.

### 5.6 Transactional boundaries and short-lived locks

§5.1’s **serialization** is the main “mutual exclusion” story: one **`handleInbound`** at a time per **`conversationKey`**. Separately, there are **narrow transactional moments** where you need **atomicity** or a **short** lock — not the same as holding a DB row open for an entire LLM call.

| Moment | Risk if racy | Typical mitigation |
|--------|----------------|-------------------|
| **Idempotency claim** | Two workers both pass `seen` → **double `run`** for the same provider message | **Atomic** “claim”: Redis `SET dedupe:{id} NX EX …`, DB **`INSERT`** with **unique** on `external_message_id`, or **single consumer** per partition so dedupe is single-threaded (§6). |
| **`findWaitingRunId` → `resume` vs `run`** | Both see “no waiting” → **two new runs** | **Serialize** the whole gateway path per key (queue / mutex). A DB snapshot alone is not enough if two coroutines interleave before either persists `running`. |
| **Flush after validation, before engine** | Sketch orders **length check** then **`markProcessed`**; cross-process races still need atomic dedupe (above). | Same as idempotency row. |
| **Batch merge (§5.2)** | Crash after marking some ids, not all → **partial consume** / retry storms | **One transaction** (or atomic multi-write) marking **all** merged ids + enqueueing the merged turn. |
| **Distributed lock as serializer** | Lock **expires** while `handleInbound` still awaits the LLM → second worker enters → **overlap** | Prefer a **FIFO queue** per key with **one consumer**; if you use Redis `SET conv:{key} NX`, TTL must exceed worst-case handler time **with renewal**, or you accept queue semantics instead. |

**Rule of thumb**: use **queues or per-key async mutexes** for **long** work (full `handleInbound`); use **atomic CAS / unique constraints / short locks** for **dedupe and routing snapshots**. Do **not** keep a SQL row locked for the duration of **`agent.run`** — persist run state via **`RunStore`** and the engine; let the **conversation serializer** prevent overlapping runs.

---

## 6. Idempotency

- Key: **`externalMessageId`** (or stable hash of the event).
- Store “already processed” with TTL aligned to provider retry behavior; the **claim** must be **atomic** across workers — see §5.6 (not only an in-memory `Set` in one process).
- Avoid duplicating **`run`** when the webhook is redelivered — duplicates are **discarded** at the gateway (§5.5) after marking the id seen.

---

## 7. Testing

- **Unit**: `ConversationGateway` with fake **`NormalizedInboundMessage`** and in-memory **`AgentRuntime`** / mock LLM.
- **Contract**: mock inbound/outbound adapters; no network required.
- **Integration**: one E2E adapter against a provider sandbox, outside the gateway unit test.

---

## 8. What this layer does not do

- It does not replace **`ContextBuilder`** or the engine protocol.
- It does not define a **single session-wide** LLM history: it remains **one `history` per `Run`**; see [`../core/11-context-builder.md`](../core/11-context-builder.md).
- It does not implement **multi-tenant auth** — that stays the host’s job ([`../core/08-scope-and-security.md`](../core/08-scope-and-security.md)).

---

## 9. Related documents

- [`13-canales-mensajeria-integracion.md`](./13-canales-mensajeria-integracion.md) — motivation and engine boundaries.
- [`07-multi-agente-rest-sesiones.md`](./07-multi-agente-rest-sesiones.md) — REST and sessions.
- [`../core/19-cluster-deployment.md`](../core/19-cluster-deployment.md) — `RunStore` and workers in distributed deployment.

---

## 10. Illustrative code sketch (TypeScript)

Not shipped code — shows how pieces wire together. Adjust imports and `findWaitingRunId` to your `RunStore` / DB.

```typescript
import { Agent, AgentRuntime, Session, type Run } from "@agent-runtime/core";

/** Normalized after your webhook / SDK adapter. */
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

/** Returns session ids for a stable conversation key (DB row, hash, etc.). */
export type SessionResolver = (conversationKey: string) => {
  sessionId: string;
  projectId: string;
};

/**
 * Returns runId if this session has a waiting run for `agentId`, else undefined.
 * Typical: list runs from RunStore / table filtered by sessionId + agentId + status "waiting".
 */
export type WaitingRunLookup = (
  sessionId: string,
  agentId: string,
) => Promise<string | undefined>;

export interface IdempotencyStore {
  seen(id: string): boolean;
  markProcessed(id: string): void;
}

/**
 * Single configuration object — avoids positional args and leaves room for
 * limits, batching, and hooks (§5 / §5.5). Extend with your own fields as needed.
 */
export interface ConversationGatewayConfig {
  /** Engine + stores (LLM, memory, runs). */
  runtime: AgentRuntime;
  /** Which `Agent.define` graph to load. */
  agentId: string;
  /** Map stable channel id → engine `Session` ids (often DB lookup). */
  resolveSession: SessionResolver;
  /** If a run is `waiting` for this session, we `resume` instead of starting a new `run`. */
  findWaitingRunId: WaitingRunLookup;
  /** Send the assistant reply on your channel (HTTP, queue, provider API, …). */
  outbound: OutboundDispatcher;
  /** Dedupe by provider message id so retries do not double-process (§6). */
  idempotency: IdempotencyStore;

  /** §5.5 — drop oversize / invalid before calling the engine. */
  limits?: {
    /** Reject before `markProcessed` so the client can fix and resend with a new id. */
    maxTextLength?: number;
    /** Hint for your queue layer; gateway sketch does not enforce depth by itself. */
    maxInboundQueueDepthPerKey?: number;
  };

  /**
   * §5.2 — documents how aggressive **merging** is; the sketch does not run a timer here — your
   * buffer worker reads these values (or you omit / null and batch outside config).
   *
   * | Value | Meaning |
   * |--------|--------|
   * | *(property omitted)* | Same as “no batching config”: one delivery → one `handleInbound` unless you batch upstream. |
   * | `null` | Explicit “merging disabled for this gateway instance” (useful in examples / feature flags). |
   * | `{ debounceMs, maxMessagesPerBatch, maxCharsPerBatch }` | Tuning for a debounce buffer: flush after **idle** `debounceMs`, or when the batch hits **message** or **char** caps (whichever comes first). Implement in your worker; see §5.2. |
   */
  batching?: {
    /** Max idle time (ms) before flushing buffered texts for a `conversationKey`. */
    debounceMs: number;
    /** Flush early if this many messages accumulated (burst cap). */
    maxMessagesPerBatch: number;
    /** Flush early if concatenated text reaches this size (safety vs LLM context). */
    maxCharsPerBatch: number;
  } | null;

  /** §5.5 — observability when a message is dropped or processing fails. */
  hooks?: {
    onDiscard?: (reason: string, msg: NormalizedInboundMessage) => void;
    onError?: (error: unknown, msg: NormalizedInboundMessage) => void;
  };
}

export class ConversationGateway {
  constructor(private readonly cfg: ConversationGatewayConfig) {}

  /** Call from your queue worker or after webhook ack — not inside a slow HTTP handler. */
  async handleInbound(msg: NormalizedInboundMessage): Promise<void> {
    const { limits, idempotency, hooks, agentId, runtime, resolveSession, findWaitingRunId, outbound } =
      this.cfg;

    // 1) Idempotency: duplicate delivery → no-op (do not mark until validation passes).
    if (idempotency.seen(msg.externalMessageId)) return;

    const maxLen = limits?.maxTextLength;
    if (maxLen != null && msg.text.length > maxLen) {
      hooks?.onDiscard?.("text_too_long", msg);
      return;
    }

    // 2) Safe to record: text is within limits; further failures are engine/transport issues.
    idempotency.markProcessed(msg.externalMessageId);

    const { sessionId, projectId } = resolveSession(msg.conversationKey);
    const session = new Session({ id: sessionId, projectId });
    const agent = await Agent.load(agentId, runtime, { session });

    try {
      const waitingRunId = await findWaitingRunId(sessionId, agentId);

      // 3) Continue a tool-waiting run, or start a fresh run for this user turn.
      const run: Run = waitingRunId
        ? await agent.resume(waitingRunId, { type: "text", content: msg.text })
        : await agent.run(msg.text);

      // 4) Minimal reply extraction — replace with your structured result handling.
      const lastResult = [...run.history].reverse().find((h) => h.type === "result");
      const replyText =
        typeof lastResult?.content === "string"
          ? lastResult.content
          : lastResult
            ? JSON.stringify(lastResult.content)
            : "";

      await outbound.sendReply(msg.conversationKey, replyText, {
        runId: run.runId,
      });
    } catch (e) {
      hooks?.onError?.(e, msg);
      throw e; // host may retry, DLQ, or map to user-visible error
    }
  }
}
```

**Notes**

- **Config**: pass a single `ConversationGatewayConfig` object; `limits`, `batching`, and `hooks` are optional tuning (defaults keep behavior minimal). For `batching`: omit the property or set `null` for no merging in the gateway; set an object to record debounce/flush caps for your buffer worker (§5.2). The sketch does not implement timers — only documents intent.
- **Serialization**: wrap `handleInbound` with a per-`conversationKey` mutex or FIFO queue so two messages never call `agent.run` concurrently for the same session. For **atomic idempotency**, resume vs run races, and batch commits, see **§5.6**.
- **`findWaitingRunId`**: implement with your persisted state (e.g. `InMemoryRunStore` / Redis `RunStore` listing runs for the agent and session).
- **Errors**: `onError` logs; rethrow so the host can map engine errors to retries / user-visible messages.

---

## 11. Usage example (wire-up)

Shows **construction** + one **`handleInbound`** call. Assumes `Agent.define` already ran at startup (same as any host). Import **`ConversationGateway`** and **`NormalizedInboundMessage`** from the module sketched in §10 (e.g. `./conversation-gateway.js`).

```typescript
import {
  Agent,
  AgentRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
} from "@agent-runtime/core";
import type { LLMAdapter } from "@agent-runtime/core";
import {
  ConversationGateway,
  type NormalizedInboundMessage,
} from "./conversation-gateway.js";

const PROJECT_ID = "demo";
const AGENT_ID = "support-bot";

/** Example: deterministic session from conversation key (replace with DB lookup). */
function resolveSession(conversationKey: string) {
  return { sessionId: `sess-${conversationKey}`, projectId: PROJECT_ID };
}

async function bootstrap() {
  // --- Persistence for this demo: in-memory run store + memory adapter ---
  const runStore = new InMemoryRunStore();
  const memoryAdapter = new InMemoryMemoryAdapter();

  const llmAdapter: LLMAdapter = {
    async generate() {
      return {
        content: JSON.stringify({
          type: "result",
          content: "Hello from the illustrative LLM.",
        }),
      };
    },
  };

  const runtime = new AgentRuntime({
    llmAdapter,
    memoryAdapter,
    runStore,
    maxIterations: 10,
  });

  await Agent.define({
    id: AGENT_ID,
    projectId: PROJECT_ID,
    systemPrompt: "You are a short-reply assistant.",
    tools: [],
    llm: { provider: "openai", model: "gpt-4o-mini" },
  });

  // --- Idempotency: replace Set with Redis/DB for multi-process / restart safety ---
  const seen = new Set<string>();
  const idempotency = {
    seen: (id: string) => seen.has(id),
    markProcessed: (id: string) => void seen.add(id),
  };

  const findWaitingRunId = async (sessionId: string, agentId: string) => {
    const waiting = await runStore.listByAgent(agentId, "waiting");
    return waiting.find((r) => r.sessionId === sessionId)?.runId;
  };

  // --- Outbound: only logging here; wire to WhatsApp/Telegram/etc. in production ---
  const outbound = {
    async sendReply(
      conversationKey: string,
      text: string,
      opts?: { runId: string },
    ) {
      console.log("[outbound]", { conversationKey, text, runId: opts?.runId });
    },
  };

  // --- Gateway: normalized inbound → run / resume → reply ---
  const gateway = new ConversationGateway({
    runtime,
    agentId: AGENT_ID,
    resolveSession,
    findWaitingRunId,
    outbound,
    idempotency,
    limits: {
      maxTextLength: 16_000,
      // maxInboundQueueDepthPerKey: 100, // enforce in your queue worker, not in the gateway sketch
    },
    /**
     * Options (§5.2): omit property | `null` | `{ debounceMs, maxMessagesPerBatch, maxCharsPerBatch }`.
     * Here `null` = explicit “no merge in this gateway”; each delivery → one `handleInbound`.
     * Pass an object when your debounce worker uses these caps to flush a merged user turn.
     */
    batching: null,
    hooks: {
      onDiscard: (reason, m) =>
        console.warn("[gateway discard]", reason, m.externalMessageId),
      onError: (err, m) =>
        console.error("[gateway error]", m.externalMessageId, err),
    },
  });

  // --- One illustrative inbound message (your adapter builds this from the provider payload) ---
  const msg: NormalizedInboundMessage = {
    conversationKey: "customer-42",
    text: "What is the status?",
    externalMessageId: "provider-msg-001",
    receivedAt: new Date().toISOString(),
  };

  await gateway.handleInbound(msg);
  // → agent.run(...) → outbound logs reply text + runId
}

// bootstrap().catch(console.error);
```

**Second message** (same `conversationKey`): call `handleInbound` again with a new `externalMessageId` — that starts a **new** `run` unless the previous run is still **`waiting`** and you implement **`resume`** via `findWaitingRunId` returning that `runId`.

---

## 12. Document status

Design proposal for **implementation in the product/host**; not a closed specification of the `agent-runtime` repo. Adjust names and DTOs to match your codebase when you implement the module.

---

## 13. Optional extensions (common follow-ups)

Not required for a first cut; add when the product needs them.

| Topic | Why it matters |
|--------|----------------|
| **Outbound idempotency** | Inbound dedupe avoids double **`run`**; you may still need **effectively-once** delivery on **`sendReply`** (provider message id, or “last reply id” per thread) if your outbound client retries. |
| **`markProcessed` before success** | The sketch marks after validation but **before** `agent.run` completes. If the process crashes after mark, webhook retry becomes a **silent no-op** — acceptable for many bots; otherwise use **claim** + **commit** (move id to “completed” only after outbound), or **DLQ** + replay policy. |
| **Scoped idempotency keys** | If `externalMessageId` is only unique **per channel account**, namespace the store: e.g. `(projectId, provider, externalMessageId)` to avoid cross-tenant collisions. |
| **Mid-run user message** | Serialization (§5.1) orders turns; if you need **cancel** or **interrupt** the current run when a new line arrives, that is a **product/engine** rule not shown in the sketch. |
| **Streaming / rich replies** | `OutboundDispatcher` can be extended with **chunks** or **structured payloads** (cards, buttons) — the sketch uses a single final **string** for simplicity. |
| **Edge verification** | **Signature** validation and raw payload trust belong in the **adapter** before **`NormalizedInboundMessage`**; see [`13`](./13-canales-mensajeria-integracion.md). |
| **Metrics / tracing** | Beyond `inbound_discarded_total`: latency (`enqueue` → first token / reply), **`run` vs `resume`** ratio, and **`runId`** ↔ **`externalMessageId`** in logs for support. |
