# Execution model: Run, states, and loop

## Run entity

Represents **one** concrete execution of the agent.

```json
{
  "runId": "uuid",
  "agentId": "string",
  "status": "running | waiting | completed | failed",
  "history": [],
  "state": {}
}
```

- **history**: append-only sequence of internal protocol messages (`thought`, `action`, `observation`, `wait`, `result`).
- **state**: snapshot for resume (e.g. `wait` pending), run working memory, etc.

## State machine (high level)

```
initialized → running ⇄ waiting → running → completed
                 ↘ failed
```

- **running**: the loop may invoke the LLM and tools.
- **waiting**: run persisted; the loop **does not** continue until `resume` or an external event per design.
- **completed**: there is a final `result` for the caller.
- **failed**: unrecoverable error or policy violation (timeout, iterations, validation).

## Engine loop (pseudocode)

```
while iterations < maxIterations:
  step = parse(llm.generate(buildContext()))
  if step.type == thought:   append history; emit hook; continue
  if step.type == action:    append; run toolRunner → observation; append; update memory; continue
  if step.type == wait:      persist run as waiting; return to caller
  if step.type == result:    append; mark completed; return
mark failed if max exceeded or parse error
```

## Iteration counter (`run.state.iteration`) and `maxIterations`

- **`maxIterations`** limits **main-loop turns** that complete after a **successful parse**, for steps of type **`thought`** or **`action`**. At the end of each such turn, the engine increments **`run.state.iteration`** (see [`Engine.ts`](../../packages/core/src/engine/Engine.ts)). It is **not** “number of LLM calls” by itself: a single turn can include one `generate` call, but parse recovery (below) may add **extra** LLM calls without incrementing **`iteration`**.
- **`wait`** and **`result`** end the loop for that run **without** incrementing **`iteration`** (the run stops or moves to **`waiting`** / **`completed`** in that same turn).
- **Parse recovery**: if **`parseStep`** fails and **`parseAttempts`** is still within **`maxParseRecovery`**, the engine **`continue`s** the `while` loop with recovery messages and **does not** increment **`iteration`**. Treat **`maxIterations`** as a cap on **successful** parsed steps of type **`thought`** / **`action`**, not on failed parses. Details: [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

## Wait and resume

When the model returns `wait`:

1. Save `status: waiting`, `pending` (reason + minimal context).
2. Return to the caller what is needed to continue (`runId`, question, etc.).
3. **`resume(runId, input)`** (or **`RunBuilder.onWait` returning a string** in the same process) reinjects the response and returns to **running**.

Typical `wait` reasons: `user_input`, `external_event`, `scheduled`.

For multi-worker clusters, persist with **`RunStore`** and call **`resume`** on whichever node handles the next request — see [19-cluster-deployment.md §3](./19-cluster-deployment.md).

## System input (minimal contract)

```json
{
  "agentId": "…",
  "input": { "type": "text", "content": "…" },
  "context": { "timestamp": "…", "source": "manual | webhook | cron" }
}
```

The engine may add `sessionId` or other scopes **by policy** without changing the loop core.

## Semi-agent (recommended policy)

- Low **maxIterations** initially.
- One LLM call + one tool per iteration if you need predictability.
- JSON schema or strict validation for the next step; failures, **abort**, and **timeouts**: [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

## Hooks (engine boundary)

The engine emits events to the SDK or server: `onThought`, `onAction`, `onObservation`, and a synchronous **`onWait`** on `EngineHooks` (notification). **`RunBuilder.onWait`** additionally accepts an async callback whose **returned string** continues the run in-process without a separate `resume` call.

**LLM hooks:** **`onLLMResponse`** runs immediately after each model **`generate`**, before **`parseStep`**. **`onLLMAfterParse`** runs after parsing, with an outcome: **`parsed`**, **`parse_failed_recoverable`**, or **`parse_failed_fatal`** (see `LLMParseOutcome` in `@agent-runtime/core`). Use **`watchUsage(runBuilder, { projectId, organizationId })`** to accumulate **`promptTokens` / `completionTokens` / `totalTokens`** and **`wasted*`** fields — wasted counts usage for calls that did not yield a valid step (failed parse, including the final fatal attempt). Effective spend is **totals minus wasted** if you bill only successful parses, or track **wasted** separately for quality metrics.
