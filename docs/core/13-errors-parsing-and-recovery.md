# Errors, cancellation, and `Step` recovery

How the engine classifies failures, updates the **run**, cancels with **abort**, applies **timeouts**, and recovers from **invalid** LLM JSON.

Execution model: [03-execution-model.md](./03-execution-model.md). `Step` shape: [07-definition-syntax.md](./07-definition-syntax.md) §5. LLM: [10-llm-adapter.md](./10-llm-adapter.md).

---

## 1. Terminal states

| State | Meaning |
|-------|---------|
| `completed` | Valid `result` processed; history closed normally. |
| `failed` | Unrecoverable error on this run; do not continue the loop without a new `run` or explicit “retry run” policy. |
| `waiting` | Not an error; run paused until `resume`. |

---

## 2. Error taxonomy (recommended)

| Category | Examples | Typical retry |
|----------|----------|----------------|
| **LLM transport** | Timeout, network, 503 | Yes, bounded ([10](./10-llm-adapter.md)) |
| **LLM rate limit** | 429 | Yes, backoff |
| **LLM client** | 400, invalid key | No |
| **Parsing** | Unreadable JSON, invalid `Step` schema | Yes, one “fix” turn (§7) |
| **Policy** | Disallowed tool, run already `completed` | No |
| **Tool** | Exception in `execute`, tool timeout | Optional 1 retry per tool; then error `observation` or `failed` |
| **Cancellation** | `AbortSignal` | No; run `failed` or `cancelled` per convention |

Export errors as **stable** classes or codes (`RUN_INVALID_STATE`, `STEP_SCHEMA_ERROR`, …) for HTTP API and SDK.

---

## 3. History on failure

- **Append** a protocol message or log entry with meta `type` (e.g. `error`) or `state.lastError` **without** breaking immutability of the rest of history: prefer **one final** documented event `meta: { engineError: true }`.
- After `failed`, reject new `action` / LLM turns; `resume` only if the product allows “retry from failed” (not recommended in MVP).

---

## 4. Cancellation and abort

- Caller passes `AbortSignal` through to **LLM Adapter** ([10](./10-llm-adapter.md)) and, when relevant, long-running tools (fetch).
- On abort: mark run `failed` with reason `cancelled` (or dedicated `cancelled` state if distinct from logical error).
- No guarantee of atomicity for tools already executed: document **compensation** or sagas in the product.

---

## 5. Timeouts

| Scope | Behavior |
|-------|----------|
| **Global run** | Timer at `run` start; on expiry, abort LLM and `failed` with `timeout`. |
| **Per iteration** | Each LLM call has a deadline; counts against global. |
| **Tool** | Optional `configureRuntime({ toolTimeoutMs })` → `ToolRunner` races tool `execute`; on expiry, **`ToolTimeoutError`** (`TOOL_TIMEOUT`) becomes an error `observation` (`success: false`) like other tool failures. Does not cancel in-flight work. |

Timeouts should honor the same `AbortSignal` when it is the shared controller.

---

## 6. Parsing `Step`

1. **Extract** JSON text from response `content` (strip ``` fences if policy allows).
2. **`JSON.parse`** → object.
3. **Validate** minimal schema:
   - `type` ∈ `thought | action | wait | result`.
   - Required fields per type (`content` or `tool`+`input`, etc.) per [07-definition-syntax.md](./07-definition-syntax.md) §5.
4. **Validate** `action.tool` ∈ agent allowlist **and** SecurityLayer permissions.

If step 2 or 3 fails:

---

## 7. Recovery via re-prompt (one turn)

- Conditions: `parseAttempts < maxParseRecovery` (typically **1**), run not aborted, iterations remaining.
- Build ephemeral **user** or **system** message: “Your last output was not valid JSON / does not match the schema. Return **only** one object with `type` and required fields. Invalid output: …” (truncate sample).
- **Do not** append invalid output to protocol history as an official `thought` if that confuses the model; optionally store in `state.debug.lastRawLlmOutput`.
- If the second attempt fails → `failed` with code `STEP_SCHEMA_ERROR`.

---

## 8. `action` with invalid tool input

- Run ToolAdapter `validate?` first.
- On failure: do not execute; emit synthetic error `observation` **or** re-prompt the LLM once with validation error (product policy). MVP: error **observation** and next loop iteration.

---

## 9. Summary

- Separate **network retries** (adapter) from **parse retries** (engine).
- **Abort** and **timeout** should propagate predictably and close the run.
- A single **parse recovery** keeps the loop understandable and cost-bounded.
