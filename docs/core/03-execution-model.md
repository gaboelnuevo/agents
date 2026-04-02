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

## Wait and resume

When the model returns `wait`:

1. Save `status: waiting`, `pending` (reason + minimal context).
2. Return to the caller what is needed to continue (`runId`, question, etc.).
3. `resume(runId, input)` reinjects the response/event and returns to **running**.

Typical `wait` reasons: `user_input`, `external_event`, `scheduled`.

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

The engine emits events to the SDK or server: `onThought`, `onAction`, `onObservation`, `onWait`. They are **observability and control**; loop semantics live **inside** the engine.
