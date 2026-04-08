# Technical debt and known gaps

English-language register of **intentional deferrals**, **plan vs implementation gaps**, and **follow-up work** for the `@agent-runtime` monorepo. It complements [`plan.md`](./plan.md) (roadmap) and [`core/19-cluster-deployment.md`](./core/19-cluster-deployment.md) (cluster patterns).

**Snapshot:** Automated **CI** (`build` / `test` / `lint`) and **per-tool timeout** (`toolTimeoutMs`, `ToolTimeoutError`) are **implemented** — see [`plan.md` — Progress snapshot](./plan.md). This file focuses on what remains.

---

## 1. Platform and packages

| Item | Notes |
|------|--------|
| **BullMQ** | **`@agent-runtime/adapters-bullmq`** ships typed queue/worker + `dispatchEngineJob`. You still configure Redis connection, queue names, retries/DLQ, and delayed `resume` jobs in your app. **QStash** is not packaged — HTTP callback pattern only in docs. |
| **`@agent-runtime/adapters-redis` (TCP Redis)** | **Preferred** for shared memory / runs / bus on `REDIS_URL`: `RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus` (`ioredis`). **Vector** remains in `adapters-upstash` (`UpstashVectorAdapter`) unless a Redis Stack / custom vector backend is added later. |
| **DB-backed `RunStore`** | Documented as a future option; current implementations are `InMemoryRunStore`, **`RedisRunStore`**, and `UpstashRunStore` (Redis JSON). |
| **`RunStore` lifecycle** | No built-in TTL, archival, or GDPR delete policies — left to product code. |
| **Message bus stream keys (Redis + Upstash)** | Both `RedisMessageBus` and `UpstashRedisMessageBus` use `bus:agent:{toAgentId}` with no `projectId`/tenant segment — if agent IDs are not globally unique, shared Redis could mix traffic across tenants; consider namespacing. |
| **`RedisMessageBus.waitFor`** | Polls with full `XRANGE` + fixed sleep — fine for tests and short streams; under load, prefer `XREAD`/`BLOCK` or consumer groups to avoid repeated full-stream reads. (`UpstashRedisMessageBus` uses a similar polling pattern.) |

---

## 2. Core engine (`packages/core`)

| Item | Notes |
|------|--------|
| **Dedicated `hooks.ts` module** | The plan references `src/engine/hooks.ts`; hooks are wired inside [`Engine.ts`](../packages/core/src/engine/Engine.ts) instead. Low priority unless hook surface grows. |
| **Hook integration tests** | Phase 4.1 calls for isolated tests of hook ordering; coverage exists indirectly via agent tests — could be expanded. |
| **`getEngineConfig` visibility** | Exported as `@internal` for tests; worker docs reference configuration patterns — consider a stable public helper if needed. |
| **`executeRun` iteration vs parse recovery** | `run.state.iteration` increments only after a successful parse and a `thought`/`action` step; invalid JSON / schema recovery loops with `continue` without incrementing — document in [`03-execution-model.md`](./core/03-execution-model.md) so `maxIterations` is not read as “number of LLM calls.” |
| **`parseStep` / step payload strictness** | Validates `type` and minimal required fields, then casts the object to `Step`; `action.input` and extra JSON keys are unconstrained — acceptable for flexibility; add schema validation or strip unknown keys if stricter contracts or safer logging are needed. |

---

## 3. Testing and CI

| Item | Notes |
|------|--------|
| **Phase 9 (integration hardening)** | **Partial:** CI runs **BullMQ + Redis** (`packages/adapters-bullmq/tests/redis-queue.integration.test.ts` with `REDIS_INTEGRATION=1` in GitHub Actions). E2E with **real** Upstash + OpenAI keys, stricter security negative tests, and production-like usage snapshots (Phase 9.2–9.6) are not all automated. See [`plan.md` §Phase 9](./plan.md). |
| **`@agent-runtime/adapters-openai`** | HTTP status → typed errors; failed `fetch` (network) → `LLMTransportError`; `AbortError` → `RunCancelledError` ([`errors.ts`](../packages/adapters-openai/src/errors.ts)). Malformed JSON in success bodies is still a rare unwrapped parse error. |
| **Multi-agent request–reply** | Phase 7 gate describes a full two-agent integration test; verify coverage in `core` vs relying on smaller tests. |

---

## 4. CLI and scaffold

| Item | Notes |
|------|--------|
| **Placeholder copy in generators** | [`generate.ts`](../packages/scaffold/src/generate.ts) emits `TODO: describe what this tool does.` / `TODO: describe this skill.` in generated files — intentional placeholders for the user to replace. |
| **Template parity** | Not all CLI templates may exercise every runtime path (e.g. `runStore`, `onWait`); align templates with [`07-definition-syntax.md`](./core/07-definition-syntax.md) over time. |

---

## 5. Documentation

| Item | Notes |
|------|--------|
| **Brainstorm vs `docs/core/`** | Older material under `docs/brainstorm/` may diverge from canonical `docs/core/` — treat `docs/core/` as source of truth. |
| **REST / MCP product APIs** | [14-consumers.md](./core/14-consumers.md) describes patterns; there is no reference HTTP server in this repo. |
| **`docs/scaffold.md` size** | Very long single file — fine as reference; for ongoing changes, splitting or doc-only PRs can ease review. |

---

## 6. Operations and runtime

| Item | Notes |
|------|--------|
| **Graceful shutdown** | [19-cluster-deployment.md §8](./core/19-cluster-deployment.md) describes waiting for in-flight `executeRun`; not enforced by a built-in supervisor. |
| **Observability** | No standard OpenTelemetry or structured logging in core — apps integrate their own. |

---

## How to use this document

- **Triaging:** Prefer turning items into tracked issues with owners.
- **Closing entries:** Remove or move to “Done” only when the codebase or tests actually reflect the fix (not when docs alone change).

Last reviewed with repository state described in [`plan.md` — Progress snapshot](./plan.md).
