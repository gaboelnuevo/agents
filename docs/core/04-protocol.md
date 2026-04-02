# Internal engine protocol

Full **JSON shapes** (agent, run, `Step` steps, etc.) are in [07-definition-syntax.md](./07-definition-syntax.md).

## Principle

Every relevant exchange is a **typed message**. The LLM produces **proposals** in that format; the engine **validates** and **materializes** effects (tools, memory, state).

## Message types

```json
{
  "type": "thought | action | observation | wait | result",
  "content": "...",
  "meta": {}
}
```

| Type | Produced by | Meaning |
|------|-------------|---------|
| `thought` | LLM (via engine) | Intermediate reasoning; no mandatory side effect. |
| `action` | LLM | Intent: tool name + input. |
| `observation` | Engine / ToolRunner | Result of executing the tool. |
| `wait` | LLM | Pause until input or external event. |
| `result` | LLM | Final response to the caller. |

## Run envelope (traceability)

```json
{
  "id": "uuid",
  "agentId": "...",
  "messages": [],
  "state": {},
  "tools": [],
  "status": "running | completed"
}
```

Useful for logs, debugging, and replaying reasoning.

## Action toward tools

Logical request (after parsing `action`):

```json
{
  "tool": "memory_search",
  "input": { "query": "open escalations this week" }
}
```

Response in history as `observation`:

```json
{
  "success": true,
  "data": []
}
```

## Prompt to the LLM

- System + structured messages (ordering and truncation: [11-context-builder.md](./11-context-builder.md)).
- List of available tools (names, schemas).
- Explicit instruction: **JSON** output parseable by the engine (type + required fields).
- If JSON fails: recovery and errors in [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

## Engine rules (invariants)

1. **The LLM does not execute tools**: it only proposes `action`; the **ToolRunner** executes.
2. **All side effects go through the engine**: permissions, limits, logging.
3. **History is immutable**: **append** only.
4. **Durable state** (business memory, wait) lives **outside** the model’s volatile context; the prompt reflects a **snapshot**, not the sole source of truth.

## Logical security

- Allowlist of tool names.
- Per-tool `input` validation (`validate?` on adapter).
- Reject actions if the run is `completed` or `failed`.

Authorization by **principal**, **project**, and scopes before the engine: [08-scope-and-security.md](./08-scope-and-security.md).
