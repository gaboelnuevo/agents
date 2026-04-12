# Engine consumers

Related: [02-architecture.md](./02-architecture.md), [05-adapters.md](./05-adapters.md), [19-cluster-deployment.md](./19-cluster-deployment.md).

Everything that **starts** or **observes** runs shares the same core: **SecurityLayer** (if applicable) → **Agent Engine**. Only **consumer types** are named here; engine contracts live in the rest of `docs/core/`.

---

## Library / SDK (Node or other runtime)

Embedded use: **`Agent.load(agentId, runtime, { session })`**, `run`, `resume`, hooks. Every worker constructs **`new AgentRuntime({ … })`** once (**`llmAdapter`**, **`memoryAdapter`**, optional **`runStore`** for cluster **`wait`/`resume`**, **`messageBus`** for cross-worker **`system_send_message`**, etc.) before handling jobs — [19-cluster-deployment.md §2](./19-cluster-deployment.md).

For **queue workers** or custom orchestration, call **`buildEngineDeps(agent, session, runtime)`**, then **`createRun(agent.id, session.id, userInput, session.projectId)`** + **`executeRun`** (add **`startedAtMs`**; optional **`resumeMessages`**). Omit the fourth argument only when you intentionally leave **`Run.projectId`** unset. When **`runStore`** is set, **persist** the returned **`Run`** after each **`executeRun`** (including **`waiting`**). You can assemble `EngineDeps` manually with **`ContextBuilder`**, **`ToolRunner`**, **`resolveToolRegistry`**, **`getAgentDefinition`**, **`effectiveToolAllowlist`**, and values from **`runtime.config`** if you need a custom layout. Syntax reference: [07-definition-syntax.md](./07-definition-syntax.md) §9. Cluster: [19-cluster-deployment.md](./19-cluster-deployment.md).

---

## CLI

Today the published binary is **scaffold-focused** (`init`, `generate`); runtime **`run` / `resume` / …** are roadmap. Planning doc: [**`plan-cli.md`**](../plan-cli.md). Brainstorm: [06-libreria-adapters-cli.md](../brainstorm/06-libreria-adapters-cli.md). Terminal output and optional local state (e.g. `.agent/`) remain the target for parity with the SDK.

---

## REST API

HTTP/JSON: list agents, `POST` run/resume, memory, run list/history, inter-agent send, define. Same semantics as the SDK; auth and rate limits before the engine. For URLs per [**`plan-rest.md`**](../plan-rest.md) (**`GET /agents`**, **`POST /agents/:agentId/run`**, …) use [**`@opencoreagents/rest-api`**](../../packages/rest-api/) (**`createRuntimeRestRouter`**) and [**`examples/plan-rest-express/`**](../../examples/plan-rest-express/). The plugin supports **inline** **`Agent.run`** (**`runtime`**) and/or **BullMQ** **`dispatch`**, fixed or multi-**`projectId`**, **`resolveApiKey`** / **`apiKey`**, and optional OpenAPI/Swagger (**`swagger: true`** or **`swagger: { … }`**) — [package README](../../packages/rest-api/README.md). The **plan-rest-express** sample turns **`swagger`** on so **`GET /openapi.json`** and **`GET /docs`** work out of the box (no **`REST_API_KEY`** on those paths). For a richer BFF with **`/v1/chat`** and SSE, use [**`examples/real-world-with-express/`**](../../examples/real-world-with-express/). For **async** (BullMQ + `dispatch`), use [**`examples/dynamic-runtime-rest/`**](../../examples/dynamic-runtime-rest/). **`plan-rest.md`** (*Implemented today: `@opencoreagents/rest-api`*, *Pick a starting point*) summarizes routes and examples. Broader brainstorm: [07-multi-agente-rest-sesiones.md](../brainstorm/07-multi-agente-rest-sesiones.md).

---

## MCP (Model Context Protocol)

**Does not** replace the engine: it is a **channel** through which a host (e.g. Cursor, Claude Desktop) exposes **tools** to the client model. An “MCP server” may **delegate** to your runtime (call your REST or library) or publish tools aligned with ToolRunner. The PDF/thread positions it as a **plug**, not the agent OS ([01-purpose.md](./01-purpose.md), layers). Planning doc: [**`plan-mcp.md`**](../plan-mcp.md).

---

## Webhooks and queues

External triggers (Stripe, GitHub, messaging): handler validates signature, builds `RunInput`, calls the engine or internal API. Same rule: **one** entry point into the loop.

Often the handler **enqueues** a job — **BullMQ** on Redis is the **primary** supported pattern — and returns quickly; a **worker** then calls **`dispatchEngineJob(runtime, payload)`** from **`@opencoreagents/core`** (often imported via **`@opencoreagents/adapters-bullmq`** re-export) or **`runtime.dispatch(payload)`** with the same payload. If the run may **`wait`** and the **resume** request is handled by **another** instance, include **`runStore`** on **`AgentRuntime`** so the **`Run`** is durable — [19-cluster-deployment.md §3](./19-cluster-deployment.md). Retries, backoff, and dead-letter queues live in the queue layer, not in the engine core. **Upstash QStash** is an **alternative** that POSTs to `resume` without a worker process. Detail: [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq).

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

---

## Production note

Any **SDK** or **queue** consumer that faces the internet should sit behind **authentication**, **tenant resolution** (`projectId`, optional `endUserId`), and **rate limits** before calling `Agent.load` / `dispatchEngineJob`. Reuse the checklist in [08-scope-and-security.md §7](./08-scope-and-security.md) and the concrete gaps in [`technical-debt.md` §7–§9](../../technical-debt.md) (tool leakage, `RunStore` races, job idempotency).
