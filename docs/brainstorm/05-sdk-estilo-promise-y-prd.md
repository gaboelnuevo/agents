# Promise-style SDK (Bluebird) and condensed PRD

## Interface goal

Using an agent should feel like **code**: composition, clean async, observable hooks—inspired by **Bluebird** (fluid control, `tap`, `timeout`, `retry`, etc.).

## Desired execution

```javascript
agent.run(input)
  .then(result => ...)
  .catch(err => ...)
  .finally(() => ...)
```

With superpowers: memory, wait/resume, tools, multiple steps.

## Concept: “super stateful Promise”

`run()` can return an **AgentExecution**-like object with:

- `then` / `catch` / `finally`
- `onThought`, `onAction`, `onObservation`, `onWait`
- extensions: `timeout(ms)`, `tap(fn)`, `retry(n)`, batch-style `map`

### Wait from the SDK

```javascript
agent.run("analyze")
  .onWait(ctx => {
    // return automatic answer or delegate to UI
    return "yes";
  })
  .then(result => ...);
```

### Full hooks

```javascript
agent.run(input)
  .onThought(t => ...)
  .onAction(a => ...)
  .onObservation(o => ...)
  .onWait(w => handleWait(w))
  .then(result => ...);
```

## Internal engine (pseudocode)

Each iteration: if `thought` → hook; if `action` → run tool → `observation`; if `wait` → resolve via hook and continue; if `result` → finish.

## Difference vs standard Promise

A normal Promise resolves once. Here there are **events**, possible **pause**, **state**, and **resume**—closer to streams/observables but with Promise ergonomics.

---

## Technical PRD (summary)

**Project**: Agent Runtime API (stateful + Promise-like).

### In scope (conceptual v1)

- Stateful execution.
- Multi-level memory.
- Tools and skills.
- Loop with **running**, **waiting**, **completed**, **failed** states.
- Promise-like interface with hooks.

### Out of v1 (per document)

- Visual builder.
- Complex collaborative multi-agent.
- Unlimited autonomy without limits.
- Advanced prompt optimization.
- MCP (optional future).

### Run (execution)

```json
{
  "runId": "uuid",
  "agentId": "string",
  "status": "running | waiting | completed | failed",
  "history": [],
  "state": {}
}
```

### Lifecycle

`initialized → running → waiting → resumed → completed` (or `failed`).

### Minimal HTTP API

| Method | Path | Use |
|--------|------|-----|
| POST | `/agent/run` | Start execution |
| POST | `/agent/resume` | Resume after `wait` |
| GET | `/agent/run/:id` | Status / inspection |

### MVP v1

- One reference agent.
- Basic memory (e.g. Mongo).
- Tools: `save_memory`, `get_memory`.
- Bounded loop (few iterations).
- **wait** support + basic Promise-like SDK.

### Success criteria

- Remember across executions.
- Pause and continue.
- Execute tools under control.
- Fluid code UX (`run` + hooks).

### Risks and mitigation

| Risk | Mitigation |
|------|------------|
| Complex loop | Iteration limit |
| LLM parsing | Strict JSON |
| Inconsistent state | Snapshots per run |

### Phases (short roadmap)

1. Engine + loop + tools.
2. Persistent memory + wait/resume.
3. Full Promise SDK.
