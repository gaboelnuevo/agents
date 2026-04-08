# REST API planning

> Roadmap for an **HTTP/JSON** layer that exposes **`run` / `resume` / memory / logs / inter-agent send** with the same semantics as the SDK. There is **no reference server** in this monorepo today — this document is the product/implementation guide when you add one. Sources: [`brainstorm/07-multi-agente-rest-sesiones.md`](./brainstorm/07-multi-agente-rest-sesiones.md) §REST, [`core/14-consumers.md`](./core/14-consumers.md) §REST API.

**Non-goals:** Putting business auth, rate limits, or multi-region deployment **inside** `packages/core` — those stay in the API service. The service constructs **`AgentRuntime`**, then **`Agent.load(agentId, runtime, { session })`**, **`RunBuilder`** (or worker pattern from [`19-cluster-deployment.md`](./core/19-cluster-deployment.md)).

---

## Current state (repository)

| Area | Status |
|------|--------|
| **Reference HTTP server** | **Out of scope / not shipped** — [`technical-debt.md`](./technical-debt.md) §5. |
| **Patterns** | **Documented** — cluster, BullMQ, QStash alternatives in `docs/core/`. |

---

## Target API shape (evolving, from brainstorm `07`)

| Method | Endpoint | Role |
|--------|----------|------|
| `GET` | `/agents` | List agent ids / metadata available to the caller’s tenant. |
| `POST` | `/agents/:id/run` | Body: user input + optional **`sessionId`**, **`endUserId`**, **`expiresAtMs`** (maps to `Session`). Returns `runId`, initial status, or async job id if enqueueing. |
| `POST` | `/agents/:id/resume` | Body: `runId` + resume payload (same contract as `Agent.resume`). |
| `GET` | `/agents/:id/memory` | Query scoped memory (design: session vs end-user — align with [`15-multi-tenancy.md`](./core/15-multi-tenancy.md)). |
| `GET` | `/runs/:runId` or `/agents/:id/logs` | Run history / status for debugging or dashboards. |
| `POST` | `/agents/:from/send` or bus-specific route | Multi-agent message to another agent (same as `send_message` semantics). |

**Cross-cutting:** Authentication (API key, JWT, mTLS), **`SecurityContext`** construction, **`SessionExpiredError`** → HTTP **401/403/440** (product choice), idempotency keys for `POST run` if jobs are retried.

---

## Phased plan

| Phase | Goal | Gate |
|-------|------|------|
| **R0 — Contract** | OpenAPI or markdown request/response schemas; error model mapping **`EngineError.code`** → HTTP status + JSON body. | Reviewed; matches `Run`, `RunStatus`, resume payload types in [`protocol`](../packages/core/src/protocol/types.ts). |
| **R1 — Minimal server** | Single-tenant demo: `POST run`, `POST resume`, `GET run` by id (in-memory or **`RedisRunStore`**). | Docker-compose or script; integration tests against real HTTP (or test harness). |
| **R2 — Async** | Optional **202** + job id when using **BullMQ** / worker; poll or webhook for completion — reuse [`adapters-bullmq`](../packages/adapters-bullmq/) patterns. | Documented flow in `19-cluster-deployment` or this file. |
| **R3 — Multi-tenant** | `projectId` / org resolution, memory routes scoped per [`15-multi-tenancy.md`](./core/15-multi-tenancy.md). | Security review; no cross-tenant `runId` leakage. |
| **R4 — Streaming (optional)** | SSE or chunked JSON for hook events (`onThought`, …) — does not replace core loop; transport only. | Load test + backpressure story. |

---

## Relationship to MCP and CLI

- **MCP**: Often implemented as a thin layer **on top of** this REST surface ([`plan-mcp.md`](./plan-mcp.md)) so there is one backend contract.
- **CLI**: [`plan-cli.md`](./plan-cli.md) may call the same HTTP API for remote projects, or the SDK locally — product choice.

---

## References

- [`brainstorm/07-multi-agente-rest-sesiones.md`](./brainstorm/07-multi-agente-rest-sesiones.md)
- [`core/14-consumers.md`](./core/14-consumers.md)
- [`plan.md`](./plan.md) — engine snapshot
- Cluster + queues: [`core/19-cluster-deployment.md`](./core/19-cluster-deployment.md)
