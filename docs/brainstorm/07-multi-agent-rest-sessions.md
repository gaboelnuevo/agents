# Multi-agent, REST API, and sessions

## Multi-agent

Agents can **send each other messages** and coordinate; a message bus is required.

### New component: MessageBus

- Per-agent queues (EventEmitter + Promise style).
- `send(destination, payload)` and correlated wait for `wait` / resume.
- Enables tools like `system_send_message`.

### Example tool: `system_send_message`

Sends to the bus; the other agent can react in its loop and reply.

### Extra CLI

```bash
agent-cli send <from> <to> --message "..."
```

### Short flow

```
AgentA → action → ToolAdapter → MessageBus → AgentB (loop) → reply → AgentA resume
```

### Multi-agent MVP

- Same core as single-agent.
- `MessageBus.js`.
- Tool `system_send_message`.
- CLI `send`.
- Hooks and Promise-style philosophy unchanged.

---

## REST API (future layer)

Goal: remote control (web, other services, dashboards) **reusing the same runtime**.

### Base endpoints (evolving)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents` | List agents |
| POST | `/agents/:id/run` | Run with input (and optional `sessionId`) |
| POST | `/agents/:id/resume` | Resume waiting run |
| GET | `/agents/:id/memory` | Memory (session or global per design) |
| GET | `/agents/:id/logs` | Execution logs |
| POST | `/agents/:from/send` | Message to another agent |

The conversation also mentions **Upstash** integration (flows, Redis, vector): triggers and queries via CLI or REST as the design evolves.

### Benefits

- Same engine for library, CLI, and HTTP.
- A `wait` can be resolved with input over REST.

---

## Session scope

Each execution can live in an **isolated context** (conversation, business cycle, A/B test):

- Memory and logs **per session** in addition to global agent state.
- Avoids contaminating long-term memory or mixing work threads.
- Fits REST (`sessionId` in body) and CLI (`--session <id>`).

### CLI example

```bash
agent-cli run <agentId> --session <sessionId> --input "..."
```

### Mental model

- **Agent**: identity and configuration.
- **Session**: temporal namespace for runs, working memory, and audit.

---

## Extended roadmap (from the thread)

1. Core + adapters + MessageBus + basic CLI.
2. Multi-provider LLM + embeddings + vector memory + sessions.
3. REST API + advanced multi-agent flows + external integrations.
