# LLM Adapter (core contract)

Layer that **unifies** calls to the model. The **engine** only talks to this interface; providers (OpenAI, Anthropic, etc.) swap without touching the loop.

Related: [02-architecture.md](./02-architecture.md); **`llmAdapter` / `llmAdaptersByProvider`** on **`AgentRuntime`** — [19-cluster-deployment.md §2](./19-cluster-deployment.md); agent **`llm`** field vs defaults — [07-definition-syntax.md](./07-definition-syntax.md) §1; prompt assembly — [11-context-builder.md](./11-context-builder.md); failures and retries — [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

---

## 1. Responsibility

| Does | Does not |
|------|----------|
| Map `LLMRequest` → vendor API | Decide `action` / `wait` / `result` |
| Return text (or JSON) + minimal metadata | Execute tools |
| Map network/API errors to runtime errors | Manage memory or runs |

---

## 2. Canonical request (conceptual)

```typescript
interface LLMRequest {
  provider: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Tool definitions for native provider *tool calling* (optional) */
  tools?: Array<{ name: string; description?: string; parameters: object }>;
  toolChoice?: "auto" | "none" | { type: "tool"; name: string };
  /** Force output parseable by the engine (JSON / schema) */
  responseFormat?: { type: "json_object" } | { type: "json_schema"; schema: object };
  temperature?: number;
  maxOutputTokens?: number;
  /** Signal for external abort (AbortSignal) */
  signal?: AbortSignal;
  /** If the provider supports streaming, adapter may emit chunks via callback (optional) */
  onStreamChunk?: (text: string) => void;
}

interface LLMResponse {
  content: string;
  /** If the provider returned native tool_calls instead of text */
  toolCalls?: Array<{ name: string; arguments: string }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | string;
  raw?: unknown;
}
```

After each `generate` call, **`executeRun`** runs **`normalizeLlmStepContent`**: if `content` is empty or whitespace-only and **`toolCalls[0]`** is present, the engine synthesizes JSON `{ type: "action", tool, input }` from that call so **`parseStep`** and **`ToolRunner`** behave like a protocol `action` step. Hooks **`onLLMResponse`** still receive the **raw** adapter response.

### Per-provider adapters

**`AgentRuntime`** (via **`EngineConfig`**) accepts:

- **`llmAdapter`** — default when `agent.llm.provider` has no dedicated entry.
- **`llmAdaptersByProvider`** — `Record<string, LLMAdapter>`; the engine picks `llmAdaptersByProvider[agent.llm.provider]` when that key exists (trimmed provider string; empty/missing provider uses `"default"`).

You must set **`llmAdapter`** and/or a **non-empty** provider map. Helpers can call **`resolveLlmAdapterForProvider`** (exported from `@agent-runtime/core`) with the same config shape.

---

## 3. JSON mode for the loop

- Recommendation: JSON-style `responseFormat` or system instruction + engine **validation** ([13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md)).
- If the model returns markdown with fences, the adapter may **not** strip them: prefer an explicit **engine parser** or configurable pre-step.

---

## 4. Mapped errors

The adapter should classify and propagate:

| Source | Typical engine handling |
|--------|-------------------------|
| Network / timeout | Optional retry in adapter or engine (**single** policy). |
| 429 / rate limit | Backoff + bounded retry; on failure → run `failed`. |
| 4xx validation | No retry; `failed` with clear code. |
| 5xx provider | Limited retry; then `failed`. |
| `content_filter` / policies | `failed` or empty `result` per product; document. |

Use **stable** error types (e.g. `LLMRateLimitError`, `LLMTimeoutError`) so the loop does not depend on vendor strings.

---

## 5. Retries

- **Where**: either inside the adapter (transparent), or in a thin layer above the adapter invoked by the engine — **not** both without coordination.
- **How much**: max attempts + backoff; honor `signal` (abort).
- **Idempotency**: LLM calls are not idempotent; retries must be **safe** if the run has not persisted partial effects, or the engine must support “same turn, second attempt” without duplicating already executed tools.

---

## 6. Streaming

- **Optional in v1**: the loop can wait for full `content`.
- If `onStreamChunk` exists: SDK hooks may show partial text; **`Step` parsing** still applies to **final** content (or partial JSON only with advanced recovery).

---

## 7. Token limits

- `maxOutputTokens` on the request; if `finishReason === "length"`, the engine may mark **parse failure** or a controlled error `Step` ([13](./13-errors-parsing-and-recovery.md)).

---

## 8. Multi-provider

- Table `provider` → adapter implementation (injection or registry).
- Same `LLMRequest` / `LLMResponse`; differences (role names, concatenated system, etc.) **only** in the adapter.
- Changing `model` / `provider` on the agent definition should not require ToolRunner or MessageBus changes.

---

## 9. Minimal suggested interface

```typescript
interface LLMAdapter {
  generate(request: LLMRequest): Promise<LLMResponse>;
}
```

Optional extensions: `listModels()`, healthcheck, streaming-only API.
