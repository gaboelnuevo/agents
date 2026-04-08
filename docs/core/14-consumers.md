# Engine consumers

Everything that **starts** or **observes** runs shares the same core: **SecurityLayer** (if applicable) → **Agent Engine**. Only **consumer types** are named here; engine contracts live in the rest of `docs/core/`.

---

## Library / SDK (Node or other runtime)

Embedded use: `Agent.load`, `run`, `resume`, hooks. For **queue workers** or custom orchestration, call **`buildEngineDeps`**, then **`createRun`** + **`executeRun`** (add **`startedAtMs`**; optional **`resumeMessages`**). You can assemble `EngineDeps` manually with **`ContextBuilder`**, **`ToolRunner`**, **`resolveToolRegistry`**, **`getAgentDefinition`**, **`effectiveToolAllowlist`**, and **`getEngineConfig`** if you need a custom layout. Syntax reference: [07-definition-syntax.md](./07-definition-syntax.md) §9. Cluster: [19-cluster-deployment.md](./19-cluster-deployment.md).

---

## CLI

Commands delegate to the SDK (`run`, `resume`, `define`, `memory`, `logs`, `send` between agents). Terminal output; optional local state (e.g. `.agent/`). More detail in [06-libreria-adapters-cli.md](../brainstorm/06-libreria-adapters-cli.md) (brainstorm, not core).

---

## REST API

HTTP/JSON: list agents, `POST` run/resume, memory, logs, inter-agent send, define. Same semantics as the SDK; auth and rate limits before the engine. Broader view: [../brainstorm/07-multi-agente-rest-sesiones.md](../brainstorm/07-multi-agente-rest-sesiones.md).

---

## MCP (Model Context Protocol)

**Does not** replace the engine: it is a **channel** through which a host (e.g. Cursor, Claude Desktop) exposes **tools** to the client model. An “MCP server” may **delegate** to your runtime (call your REST or library) or publish tools aligned with ToolRunner. The PDF/thread positions it as a **plug**, not the agent OS ([01-purpose.md](./01-purpose.md), layers).

---

## Webhooks and queues

External triggers (Stripe, GitHub, messaging): handler validates signature, builds `RunInput`, calls the engine or internal API. Same rule: **one** entry point into the loop.

Often the handler **enqueues** a job — **BullMQ** on Redis is the **primary** supported pattern — and returns quickly; a **worker** then calls the engine with the same payload. Retries, backoff, and dead-letter queues live in the queue layer, not in the engine core. **Upstash QStash** is an **alternative** that POSTs to `resume` without a worker process. Detail: [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq).

---

## Cron / schedulers

Periodic execution or `wait` with `reason: scheduled`: prefer **BullMQ** delayed/repeatable jobs; **QStash** or **cron** if you choose the HTTP-only or time-based path. The job wakes `resume` or a new `run` with context fixed in the payload.

---

## Summary

| Consumer | Typical role |
|----------|----------------|
| SDK | In-app integration |
| CLI | Human operation and debugging |
| REST | Remote clients, dashboards, BFF |
| MCP | Interop with IDEs and assistants that speak “tools” |
| Webhooks / cron | Event-driven and time-based input |
| Job workers (**BullMQ** primary) | Async `run` / `resume`; optional MessageBus — [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq); **QStash** as alt |

Deeper implementation of each is **out of scope** for this file.
