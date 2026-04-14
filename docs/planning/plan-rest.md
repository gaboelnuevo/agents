# REST API planning

> **Product vision:** an HTTP/JSON layer for **`run` / `resume` / memory / logs / inter-agent send`** with SDK semantics. **Monorepo reality:** the engine is **`@opencoreagents/core`**; transport is **your** BFF or a **library router** — see **`@opencoreagents/rest-api`** below (this file is the **contract reference** for that package’s URL shape).

Sources: [`brainstorm/07-multi-agent-rest-sessions.md`](../brainstorm/07-multi-agent-rest-sessions.md) §REST, [`core/14-consumers.md`](../core/14-consumers.md) §REST API, gap register [`technical-debt.md`](./technical-debt.md) (hub): [`technical-debt-platform-core-ci.md`](./technical-debt-platform-core-ci.md) §1, [`technical-debt-deferred.md`](./technical-debt-deferred.md) §3 (docs), [`technical-debt-security-production.md`](./technical-debt-security-production.md) §1 (security).

---

## What this document is (and is not)

| Concept | Meaning |
|---------|---------|
| **This file** | **Roadmap** (phases, gaps) **plus** the **URL contract** that [`@opencoreagents/rest-api`](../../packages/rest-api/) implements for **`GET /agents`**, **`GET /agents/:agentId/memory`** and **`POST /agents/:fromAgentId/send`** (with **`runtime`**; send needs **`runtime.config.messageBus`**), **`POST /agents/:agentId/run`**, **`POST /agents/:agentId/resume`**, **`GET /runs/:runId`**, **`GET /runs/:runId/history`**, **`GET /agents/:agentId/runs`** (with **`runStore`**), optional **`GET /jobs/:jobId`**. |
| **Not included** | There is **no** single “product REST server” binary in the repo (no `rest serve` CLI, no rate limits inside `core`). Auth, tenancy policy, and extra routes stay in **your** app or examples. |
| **What you build** | **`AgentRuntime`** + **`Agent.load` / `run` / `resume`** (or **`dispatch` / `dispatchEngineJob`** on workers). HTTP is optional glue — [`19-cluster-deployment.md`](../core/19-cluster-deployment.md). |

**Non-goals:** Business auth, rate limits, multi-region — **outside** `packages/core`. Same as [`08-scope-and-security.md`](../core/08-scope-and-security.md).

---

## Implemented today: `@opencoreagents/rest-api`

Express **`Router`** from **`createRuntimeRestRouter(options)`** after **`Agent.define`**. Canonical detail: [`packages/rest-api/README.md`](../../packages/rest-api/README.md).

| Method | Path | Behavior |
|--------|------|----------|
| **GET** | `/agents` | Lists agents for effective **`projectId`**: all registry agents, or **`agentIds`** ∩ registry when allowlist is set. |
| **GET** | `/agents/:agentId/memory` | When **`runtime`** is set: **`?sessionId=`** + **`?memoryType=`** required; optional **`?endUserId=`**. Calls **`MemoryAdapter.query`** (same **`MemoryScope`** as built-in memory tools). **Not** registered enqueue-only (**`dispatch`** without **`runtime`**). |
| **POST** | `/agents/:fromAgentId/send` | When **`runtime`** is set: JSON **`toAgentId`**, **`payload`** (required); optional **`type`** (**`event`** \| **`request`** \| **`reply`**), **`correlationId`** (required for **`request`**/**`reply`**), **`sessionId`**, **`endUserId`** (policy only). Calls **`MessageBus.send`** — same semantics as **`system_send_message`**; optional **`sendMessageTargetPolicy`** on **`AgentRuntime`** can return **403**. **501** if **`messageBus`** is missing on **`AgentRuntime`**. Path **`fromAgentId`** must be a known runnable agent for the tenant. **Not** registered without **`runtime`**. |
| **POST** | `/agents/:agentId/run` | Body: **`message`** (required), optional **`sessionId`**, **`projectId`** (multi-tenant), **`wait`** (with **`dispatch`**). Inline: **`Agent.run`**. JSON responses include effective **`projectId`**. Queue: **`engine.addRun`** → **202** + **`jobId`** / **`projectId`** / **`statusUrl`**, or **`?wait=1`** / **`wait: true`** with **`queueEvents`**. |
| **POST** | `/agents/:agentId/resume` | Body: **`runId`**, **`sessionId`**, **`resumeInput` `{ type, content }`**, optional **`projectId`**, **`wait`**. Inline needs **`runStore`** on **`AgentRuntime`**. JSON responses include effective **`projectId`** when enqueuing or completing inline. |
| **GET** | `/runs/:runId?sessionId=` | Snapshot from **`runStore`**; **`sessionId`** query required; checks session match; when **`run.projectId`** is set, must match effective tenant (**403**). Response may include **`projectId`**. |
| **GET** | `/runs/:runId/history?sessionId=` | Full **`Run.history`** (**`ProtocolMessage[]`**) — same **`sessionId`** / **`run.projectId`** rules as **`GET /runs/:runId`**. |
| **GET** | `/agents/:agentId/runs` | With **`runStore`**: dashboard-style list via **`RunStore.listByAgent`** — optional **`?status=`**, **`?sessionId=`**, **`?limit=`** (default **50**, max **100**). Rows with **`run.projectId`** set are dropped when it disagrees with the effective tenant (same legacy caveat as **`GET /runs`** when **`projectId`** is absent on stored runs — [`technical-debt-security-production.md`](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) §1). |
| **GET** | `/jobs/:jobId` | Only with **`dispatch`** — BullMQ job state + **`run`** summary when completed. |

**Options (summary):** **`runtime`** (inline + memory + inter-agent send when **`runtime.config.messageBus`** is set), **`dispatch: { engine, queueEvents?, jobWaitTimeoutMs? }`** (BullMQ, peers **`@opencoreagents/adapters-bullmq`** + **`bullmq`**), **`projectId`** (fixed tenant) or multi-tenant via **`X-Project-Id`** → **`?projectId=`** → **`body.projectId`**, **`resolveProjectId(req)`**, **`allowedProjectIds`**, **`agentIds`**, **`apiKey`** / **`resolveApiKey(req, res)`** (tenant resolved **before** auth — use **`getRuntimeRestRouterProjectId(res)`** for per-project secrets), **`runStore`**, **`swagger`** (OpenAPI **3.0** + Swagger UI on **`/openapi.json`** / **`/docs`** by default).

**Exports:** **`createRuntimeRestRouter`**, **`defaultRuntimeRestResolveProjectId`**, **`getRuntimeRestRouterProjectId`**, **`mapEngineErrorToHttp`**, **`RUNTIME_REST_ENGINE_ERROR_CODES`**, **`isBullmqJobWaitTimeoutError`**, **`buildRuntimeRestOpenApiSpec`**, **`normalizeRuntimeRestSwaggerPaths`**, **`runtimeRestSwaggerInfo`**, **`runtimeRestSwaggerUiHtml`**, **`summarizeEngineRun`**, **`summarizeRunListEntry`**, **`RuntimeRestRunListItem`**.

**Limits / gaps (library, not product):** JSON body **512kb**; **no** **`endUserId`** / **`expiresAtMs`** on **`POST` run/resume** bodies (use **`dispatch`** / **`EngineJobPayload`** if needed); **read-only** memory via **`GET …/memory`** ( **`endUserId`** as query only); **no** define CRUD routes; **no** in-router rate limit or idempotency; legacy **`Run`** rows without **`projectId`** skip tenant check on **`GET /runs`** until migrated on resume — [`technical-debt-security-production.md`](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) §1. Non-**`EngineError`** failures still return generic bodies (**500** / **400**). **`MessageBus`** keys are **`toAgentId`**-scoped — same shared-store caveats as [**`technical-debt-platform-core-ci.md`**](./technical-debt-platform-core-ci.md#1-platform-and-packages) §1 (**Message bus stream keys**). With **`swagger`**, **`/openapi.json`** and **`/docs`** skip API-key middleware and Swagger UI loads from **unpkg** — host CSP / network policy: [**`technical-debt-platform-core-ci.md`**](./technical-debt-platform-core-ci.md#1-platform-and-packages) §1 (**`rest-api`** row), [`technical-debt-security-production.md`](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) §1 (**OpenAPI / Swagger UI**), [`technical-debt-security-production.md`](./technical-debt-security-production.md#3-production-architecture-checklist-host--operator) §3. **Dispatch + external definition store:** **`GET /agents`** / **`POST …/run`** still consult the **in-process** agent registry (**`getAgentDefinition`**) — not Redis. Hosts that keep definitions only in **`DynamicDefinitionsStore`** must **`syncProjectDefinitionsToRegistry`** on the API process or extend the router; see [**Platform §1 — `rest-api` + Redis-only catalog**](./technical-debt-platform-core-ci.md#1-platform-and-packages).

**Try it:** [`examples/plan-rest-express/`](../../examples/plan-rest-express/) — enables **`swagger`** (**`GET /openapi.json`**, **`GET /docs`**) without **`REST_API_KEY`**.

---

## Current state (repository)

| Area | Status |
|------|--------|
| **Runtime REST router (library)** | **Shipped** — section above + [`packages/rest-api/`](../../packages/rest-api/). |
| **Minimal sample** | [`examples/plan-rest-express/`](../../examples/plan-rest-express/). |
| **Richer BFF (different URLs)** | [`examples/real-world-with-express/`](../../examples/real-world-with-express/) — **`/v1/chat`**, SSE, etc. |
| **Async + Redis definitions CRUD** | [`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/) — BullMQ worker, hydrate, **not** the same path layout as **`rest-api`** (map URLs yourself or mount **`createRuntimeRestRouter`** beside **`/v1/...`**). |
| **Dynamic definitions package** | [`@opencoreagents/dynamic-definitions`](../../packages/dynamic-definitions/) — [`21-dynamic-runtime-rest.md`](../core/21-dynamic-runtime-rest.md). |

**Clarification — `dynamic-runtime-rest`:** That example focuses on **infrastructure** (queue, worker, Redis definitions). It **does not have to** expose **`POST /agents/:id/run`** as public paths; **`@opencoreagents/rest-api`** **does** expose that shape. You can combine both: same **`addRun` / `addResume`** payload, **`createRuntimeRestRouter({ dispatch })`** on the API, worker from the example.

---

## REST without dynamic definitions

Orthogonal to [`@opencoreagents/dynamic-definitions`](../../packages/dynamic-definitions/): **`Agent.define`** at bootstrap, **`AgentRuntime`** without **`dynamicDefinitionsStore`**, **`GET /agents`** from registry (as **`rest-api`** does when **`agentIds`** is omitted). Omit Redis definition CRUD if you do not need them.

---

## Delivery shape (how it becomes runnable code)

| Shape | Status in monorepo |
|-------|---------------------|
| **A — Example app** | e.g. [`plan-rest-express`](../../examples/plan-rest-express/), [`dynamic-runtime-rest`](../../examples/dynamic-runtime-rest/). |
| **B — Library router** | **`@opencoreagents/rest-api`** — `import { createRuntimeRestRouter } from '@opencoreagents/rest-api'`. |
| **B′ — Package + CLI `serve`** | **Not** shipped; optional future — [`plan-cli.md`](./plan-cli.md). |
| **C — `cli rest serve`** | Roadmap only. |

**Typical env (host-owned):**

| Variable | Role |
|----------|------|
| **`PORT`** | Listen port (your **`app.listen`**). |
| **`REDIS_URL`** | **`RunStore`**, BullMQ, memory adapters — when used. |
| **`REST_API_KEY`** / per-tenant secrets | Use **`resolveApiKey`** + **`getRuntimeRestRouterProjectId`** or static **`apiKey`** — see package README. |

Idempotency, JWT → **`projectId`** (**`resolveProjectId`**), mTLS, rate limits: **your** middleware around the router.

---

## Pick a starting point

| Goal | Start here |
|------|------------|
| **This doc’s URL shape on Express** | [`@opencoreagents/rest-api`](../../packages/rest-api/) + [`plan-rest-express`](../../examples/plan-rest-express/). |
| **Chat-shaped BFF + SSE** | [`real-world-with-express`](../../examples/real-world-with-express/). |
| **202 + worker + Redis definitions** | [`dynamic-runtime-rest`](../../examples/dynamic-runtime-rest/) (add **`createRuntimeRestRouter({ dispatch })`** if you want **`/agents/...`** on the same API). |
| **No HTTP** | [`minimal-run`](../../examples/minimal-run/). |
| **OpenClaw / AgentSkills `SKILL.md` on disk + `exec`** | [`load-openclaw-skills`](../../examples/load-openclaw-skills/) (**`skill-loader-openclaw`**, mock LLM, no keys). |

**TLS:** Terminate at reverse proxy or dev tooling — not in `core`.

---

## Target API shape (full vision vs `rest-api`)

Long-term product surface (from brainstorm **`07`**). **`rest-api`** covers only the rows marked **✓** today.

| Method | Endpoint | Role | In `rest-api` |
|--------|----------|------|---------------|
| **GET** | `/agents` | List agent ids for tenant | ✓ |
| **POST** | `/agents/:id/run` | User message → run (job or inline) | ✓ (`message` body; no **`endUserId`**/**`expiresAtMs`** in HTTP — use queue payload) |
| **POST** | `/agents/:id/resume` | Resume **`wait`** | ✓ |
| **GET** | `/runs/:runId` | Run snapshot | ✓ ( **`sessionId`** query; **`run.projectId`** vs tenant when set — debt §1) |
| **GET** | `/runs/:runId/history` | Full **`Run.history`** | ✓ (same **`sessionId`** / tenant rules) |
| **GET** | `/agents/:id/memory` | Scoped memory read | ✓ (**`MemoryAdapter.query`**; needs router **`runtime`**) |
| **GET** | `/agents/:id/runs` | List run summaries (dashboard) | ✓ (**`RunStore.listByAgent`** + tenant filter when **`run.projectId`** set — debt §1) |
| **GET** | `/agents/:id/logs` or extended run history | Dashboards | **`GET /runs/:runId/history`** (full **`Run.history`**) + **`GET /agents/:id/runs`** (list summaries); no separate **`/agents/:id/logs`** path |
| **POST** | `/agents/:from/send` | Inter-agent | ✓ (**`MessageBus.send`**; **`system_send_message`** rules; needs **`runtime` + `messageBus`**) |

**Cross-cutting:** **`resolveApiKey`** / **`apiKey`**, **`resolveProjectId`** for JWT; do **not** trust **`X-Project-Id`** alone on the public internet. **`SessionExpiredError`** → your HTTP mapping. Idempotency for **`POST run`**: not in the library.

---

## Phased plan

| Phase | Goal | Monorepo today |
|-------|------|----------------|
| **R0 — Contract** | OpenAPI + error model | **`swagger`** + **`buildRuntimeRestOpenApiSpec`**: **`RuntimeRestJsonError`**; paths gated by **`hasDispatch`**, **`hasMemoryRead`**, **`hasInterAgentSend`**, **`hasRunStore`** (incl. **`/agents/{agentId}/runs`**, **`/runs/{runId}/history`**, **`/agents/{fromAgentId}/send`**). **`mapEngineErrorToHttp`** for **`EngineError`** on inline **`run` / `resume` / `GET /runs*`**. **`RUNTIME_REST_ENGINE_ERROR_CODES`**. |
| **R1 — Minimal server** | run / resume / run read / inter-agent | **`rest-api`** inline + **`runStore`**; **`GET /agents/:id/memory`**, **`GET /agents/:id/runs`**, **`GET /runs/:id`**, **`GET /runs/:id/history`**, **`POST …/send`** with **`runtime`** (**`messageBus`** for send); tests cover memory, list, history, **`MessageBus`**, resume after **`wait`**, **`agentIds`** ∩ registry. |
| **R2 — Async** | **202** + poll | **`dispatch`** + **`GET /jobs/:jobId`**, **`wait=1`** (tested); **`isBullmqJobWaitTimeoutError`** for **504** vs **502** on **`waitUntilFinished`**; worker = [`dispatchEngineJob`](../../packages/core/src/engine/dispatchJob.ts) / [`21-dynamic-runtime-rest.md`](../core/21-dynamic-runtime-rest.md). |
| **R3 — Multi-tenant** | Safe tenancy | Fixed / resolved **`projectId`**, **`allowedProjectIds`**, **`resolveApiKey`**; **`Run.projectId`** + **`GET /runs`** **403** on mismatch; legacy runs → [`technical-debt-security-production.md`](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) **§1**. |
| **R4 — Streaming** | SSE / hooks on wire | Not in **`rest-api`**; see **`real-world-with-express`**. |

---

## Library contract vs host-owned gaps

For the **URL table in § Implemented today**, the **`@opencoreagents/rest-api`** surface described there is **implemented** in the package. Items that stay **outside** the library (by design) include: **SSE** / token streaming (**R4** — **`real-world-with-express`**), **HTTP inbox / poll** for **`MessageBus`** receive (only **`POST …/send`** is standardized here), **idempotency** and strict **authZ** for **`POST` run**, and **`endUserId` / `expiresAtMs`** on **`POST` run/resume** JSON (use **`dispatch`** / **`EngineJobPayload`**). Optional product packaging (**`rest serve`**, **`plan-cli.md`**) remains roadmap-only.

---

## Relationship to MCP and CLI

- **MCP:** Often wraps this contract — [`plan-mcp.md`](./plan-mcp.md).
- **CLI:** Scaffold today; **`rest serve`** optional — [`plan-cli.md`](./plan-cli.md).

---

## References

- [`brainstorm/07-multi-agent-rest-sessions.md`](../brainstorm/07-multi-agent-rest-sessions.md)
- [`core/14-consumers.md`](../core/14-consumers.md)
- [`packages/rest-api/README.md`](../../packages/rest-api/README.md)
- [`examples/plan-rest-express/`](../../examples/plan-rest-express/)
- [`examples/real-world-with-express/`](../../examples/real-world-with-express/)
- [`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/)
- [`examples/README.md`](../../examples/README.md)
- [`plan.md`](./plan.md)
- [`technical-debt.md`](./technical-debt.md) (hub: [`technical-debt-security-production.md`](./technical-debt-security-production.md), [`technical-debt-platform-core-ci.md`](./technical-debt-platform-core-ci.md), [`technical-debt-deferred.md`](./technical-debt-deferred.md))
- Cluster: [`core/19-cluster-deployment.md`](../core/19-cluster-deployment.md)
- Dynamic runtime: [`core/21-dynamic-runtime-rest.md`](../core/21-dynamic-runtime-rest.md)
