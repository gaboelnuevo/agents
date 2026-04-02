# Communication protocol and loop

## Principle

Everything is a **structured message**, not loose strings. Interaction between input, agent, memory, tools, and model is standardized.

## Request (system input)

```json
{
  "agentId": "ops-analyst",
  "input": {
    "type": "text",
    "content": "Ticket #4412: refund still pending after 5 business days"
  },
  "context": {
    "timestamp": "...",
    "source": "manual | webhook | cron"
  }
}
```

## Agent context (what the agent “sees”, built internally)

Includes system, input, memory (short / long / working), list of available tools and skills. That is what gets condensed for the LLM.

## Message types (internal protocol)

```json
{
  "type": "thought | action | observation | result | wait",
  "content": "...",
  "meta": {}
}
```

| Type | Use |
|------|-----|
| `thought` | Intermediate reasoning. |
| `action` | Decision to invoke a tool (name + input). |
| `observation` | Result returned by the tool. |
| `result` | Final response to the user or caller. |
| `wait` | Pause until an external condition (see below). |

## Loop flow

```
Input → Context Builder → LLM (thought/action/wait/result)
  → Tool Runner (if action) → Observation → (repeat or finish)
```

## Internal envelope (mini protocol)

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

## Communication with tools

Request:

```json
{
  "tool": "memory_search",
  "input": { "query": "open escalations this week" }
}
```

Response:

```json
{
  "success": true,
  "data": []
}
```

## LLM: expected format

- Context always structured (system + messages + tool definitions if applicable).
- Force **JSON** output when the engine must parse actions.

## Critical rules

1. The LLM **does not execute** anything directly; it only proposes actions.
2. Everything goes through the **engine** (validation, execution, logging).
3. **Immutable messages**: append, do not edit history.
4. **State** lives outside the model (DB/working memory), not only in the prompt.

## **`wait` state** (in addition to loop and done)

Problem: sometimes the agent must **wait** (user, external API, time).

### Three cycle states

- **loop**: keeps reasoning / acting.
- **done**: finished with a result.
- **wait**: persist state and exit until an external event.

### `wait` message

```json
{
  "type": "wait",
  "reason": "user_input | external_event | scheduled",
  "details": {}
}
```

Examples of `reason`:

- `user_input`: ask and resume with the answer.
- `external_event`: external system signal or webhook.
- `scheduled`: resume after a delay.

### Persisted state in wait

```json
{
  "status": "waiting",
  "lastStep": "...",
  "pending": {
    "type": "user_input",
    "context": {}
  }
}
```

### Resume

```http
POST /agent/resume
```

```json
{
  "agentId": "...",
  "runId": "...",
  "input": "yes"
}
```

### Mental model

- *running*: thinking.
- *done*: finished.
- *waiting*: waiting for something from the real world.

Optionally model as a state machine: `running → waiting → resumed → running → done`.

## Bonus: history for debugging

Saving sequences `[thought, action, observation, …]` lets you visualize reasoning and compare runs.
