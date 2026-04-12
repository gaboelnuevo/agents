# Implementation plan

> Actionable step-by-step guide to build the `@opencoreagents` monorepo from zero. Each phase has a **gate** — criteria that must pass before moving on. Derived from `docs/scaffold.md` and `docs/core/`.

**Canonical contracts:** [`docs/core/README.md`](./core/README.md) (engine, adapters, cluster). **Monorepo package map / file tree:** [`docs/scaffold.md`](./scaffold.md) §0–§1.

**Related planning (consumer surfaces, not part of the core monorepo phases above):**

| Doc | Topic |
|-----|--------|
| [`plan-cli.md`](./plan-cli.md) | **`@opencoreagents/cli`**: scaffold (done) vs future **`run` / `resume` / memory / logs**. |
| [`plan-rest.md`](./plan-rest.md) | **HTTP/JSON** — vision + **`@opencoreagents/rest-api`** (`createRuntimeRestRouter`), async **`dispatch`**, tenancy, gaps. |
| [`plan-mcp.md`](./plan-mcp.md) | **Model Context Protocol** — MCP server as channel over SDK or REST. |

**Runnable examples:** [`examples/minimal-run`](../examples/minimal-run/) (mock LLM, **`AgentRuntime`**, no keys); [`examples/openai-tools-skill`](../examples/openai-tools-skill/) (`OpenAILLMAdapter` + tool + skill, **`OPENAI_API_KEY`**); [`examples/console-wait`](../examples/console-wait/) (**`onWait`** + stdin); [`examples/rag`](../examples/rag/) (**`registerRagToolsAndSkills`**, **`registerRagCatalog(runtime, …)`**, **`system_ingest_rag_source`** / **`system_vector_search`**; optional **`start:openai`**); [`examples/rag-contact-support`](../examples/rag-contact-support/) (same RAG stack + custom **`contact_support`** tool, scripted LLM).

---

## Progress snapshot

| Track | Status |
|-------|--------|
| **Phases 0–4** (monorepo → core loop → **TCP Redis** + Upstash REST → OpenAI LLM → hooks / global + **per-tool** timeout / abort) | **Done** — `pnpm turbo run build test lint` passes workspace-wide |
| **RunStore + resume** (`AgentRuntime` + **`runStore`**, `InMemoryRunStore`, **`RedisRunStore`** / `UpstashRunStore`, `Agent.resume`, `RunBuilder` persistence) | **Done** — see `docs/core/19-cluster-deployment.md` §3 |
| **Worker / direct engine API** (`buildEngineDeps(agent, session, runtime)`, `createRun`, `executeRun`, `dispatchEngineJob(runtime, payload)` in **`packages/core`**, `effectiveToolAllowlist`, optional **`AgentRuntime.allowedToolIds`**, `getAgentDefinition`, `resolveToolRegistry`, `securityContextForAgent`) | **Done** — same loop as `RunBuilder`; BullMQ package re-exports dispatch; tests: `packages/core/tests/engine.test.ts`, `adapters-bullmq/tests/dispatch.test.ts` |
| **`RunBuilder.onWait`** (in-process continuation after `wait` when callback returns text) | **Done** |
| **Per-tool timeout** (`toolTimeoutMs` on **`AgentRuntime`**, `ToolTimeoutError` / `TOOL_TIMEOUT`) | **Done** — [`ToolRunner`](../packages/core/src/tools/ToolRunner.ts) |
| **Phases 6–8** (RAG pipeline, multi-agent `MessageBus` + `system_send_message`, CLI + scaffold) | **Done** |
| **Phase 5** (**BullMQ priority**) | **`@opencoreagents/adapters-bullmq` shipped** — typed `createEngineQueue` / `createEngineWorker`; **`dispatchEngineJob`** in **`core`** (re-exported); **QStash** still not in monorepo; delayed-job orchestration for `wait` remains app-specific on top of BullMQ |
| **Phase 2** (`@opencoreagents/adapters-redis` — **preferred** for `REDIS_URL` / BullMQ-style stacks) | **Done** — TCP `ioredis`: memory, RunStore, MessageBus. Vector stays in **Phase 2a** / **`UpstashVectorAdapter`** unless you swap `VectorAdapter`. |
| **Phase 2a** (`@opencoreagents/adapters-upstash` — REST + vector) | **Done** — `UpstashRedisMemoryAdapter`, `UpstashRunStore`, `UpstashRedisMessageBus`, `UpstashVectorAdapter` for serverless/edge or when you want HTTP-only Redis. |
| **CI** (GitHub Actions) | **Done** — [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): `pnpm install --frozen-lockfile` → `pnpm turbo run build test lint`; **Redis** service + `REDIS_INTEGRATION=1` runs **`adapters-bullmq`** [`redis-queue.integration.test.ts`](../packages/adapters-bullmq/tests/redis-queue.integration.test.ts) (enqueue → worker → **`dispatchEngineJob(runtime, payload)`**) |
| **Phase 9** (full-stack integration hardening) | **Partial** — CI: **BullMQ + Redis**. Core: **`memory-scope`** (9.2 **`InMemory`**), **`parse-recovery`**, **`runtime-limits`**, **`watch-usage`**, **`hooks`**, **`multi-agent`**, plus **`rag-file-catalog`**, **`vector-limits`**, **`send-message-validation`**, **`tool-failure-observation`**, **`run-store`**. **E2E with real API keys**, **9.1**, **9.2** on TCP Redis, **9.4** still optional / manual |
| **Core Vitest suite** (`packages/core/tests`) | **Green in CI** — includes **`engine`**, **`run-store`**, **`session-expiry`**, **`rag-file-catalog`**, **`runtime-tool-allowlist`**, **`send-message-validation`**, **`vector-limits`**, **`tool-failure-observation`**, **`memory-scope`**, **`parse-recovery`**, **`runtime-limits`**, **`watch-usage`**, **`hooks`**, **`multi-agent`**, plus **`skill-define`**, **`tool-runner`**, **`resolve-llm-adapter`** |
| **Session expiry** | **Done** — optional **`SessionOptions.expiresAtMs`** / **`Session.isExpired()`**; **`RunBuilder`** rejects expired sessions on **`run`**, **`resume`**, and **`onWait`** continuations; **`SessionExpiredError`** (`SESSION_EXPIRED`) — tests: `packages/core/tests/session-expiry.test.ts` |

For package-level detail, see **`docs/scaffold.md` §0.8** and **§12**. Known gaps and deferrals: [**`docs/technical-debt.md`**](./technical-debt.md).

---

## Phase 0 — Monorepo bootstrap

**Goal:** Empty packages compile and Turborepo runs all tasks in topological order.

| Step | Action | Verify |
|------|--------|--------|
| 0.1 | Create repo root: `pnpm init`, set `"private": true`, `"packageManager": "pnpm@9.15.4"` | `package.json` exists |
| 0.2 | Create `pnpm-workspace.yaml` with `packages: ["packages/*"]` | — |
| 0.3 | Create `turbo.json` with `build`, `dev`, `test`, `typecheck`, `lint`, `clean` tasks | — |
| 0.4 | Create `tsconfig.base.json` (ES2022, bundler resolution, strict) | — |
| 0.5 | Add root devDeps: `turbo`, `typescript`, `vitest`, `eslint`, `prettier`, `@types/node`, `tsup` | `pnpm install` succeeds |
| 0.6 | Scaffold `packages/core/` — `package.json`, `tsconfig.json`, `tsup.config.ts`, empty `src/index.ts` | — |
| 0.7 | Scaffold `packages/utils/` — same template | — |
| 0.8 | Scaffold `packages/adapters-upstash/` — add `workspace:*` dep on `core` | — |
| 0.9 | Scaffold `packages/adapters-openai/` — add `workspace:*` dep on `core` | — |
| 0.10 | Scaffold `packages/rag/` — add `workspace:*` deps on `core` + `utils` | — |
| 0.11 | Scaffold `packages/cli/` — add `workspace:*` deps on `core` + `scaffold` | — |
| 0.12 | Scaffold `packages/scaffold/` — add `workspace:*` dep on `core` | — |
| 0.13 | `pnpm install` — verify workspace links | All packages in `pnpm-workspace.yaml` linked |
| 0.16 | *(Phase 2)* Add `packages/adapters-redis/` | Same scaffold as 0.8 (`workspace:*` → `core`); eighth workspace package |
| 0.17 | *(Phase 5)* Add `packages/adapters-bullmq/` — `workspace:*` → `core`, dependency on **`bullmq`** | Ninth package; primary job-queue integration |
| 0.14 | Add `.eslintrc.js` (or `eslint.config.mjs`), `.prettierrc`, `.gitignore`, `.env.example` | — |
| 0.15 | Add optional `vitest.workspace.ts` at root | — |

**Gate:** `pnpm turbo build` completes for all packages. `pnpm turbo typecheck` passes. All `dist/` dirs created with `index.js` + `index.d.ts`.

---

## Phase 1 — Core loop (no persistence)

**Goal:** The engine can run a full `thought → action → observation → result` cycle with in-memory adapters and mock LLM.

**Package:** `packages/core`

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 1.1 | Protocol types (`RunStatus`, `Step`, `ProtocolMessage`, `Run`, `RunEnvelope`) | `src/protocol/types.ts` | Type-only — compile check |
| 1.2 | Error classes (`EngineError` + concrete subclasses, incl. `SessionExpiredError`) | `src/errors/index.ts` | Unit: instantiate each, verify `code` |
| 1.3 | `LLMAdapter`, `LLMRequest`, `LLMResponse` interfaces | `src/adapters/llm/LLMAdapter.ts` | Type-only |
| 1.4 | `MemoryAdapter`, `MemoryScope` interfaces | `src/adapters/memory/MemoryAdapter.ts` | Type-only |
| 1.5 | `InMemoryMemoryAdapter` | `src/adapters/memory/InMemoryMemoryAdapter.ts` | Unit: save/query/delete/getState with scope |
| 1.6 | `ToolAdapter`, `ToolContext`, `ObservationContent` interfaces | `src/adapters/tool/ToolAdapter.ts` | Type-only |
| 1.7 | `SecurityContext`, `SessionOptions` types | `src/security/types.ts` | Type-only |
| 1.8 | `SecurityContext` + `SessionOptions`; embedded context via **`securityContextForAgent`** (`buildEngineDeps`) | `src/security/types.ts`, `src/engine/buildEngineDeps.ts` | No in-core HTTP **`SecurityLayer`** module — hosts authenticate **before** **`Agent.load`**; see [`08-scope-and-security.md`](./core/08-scope-and-security.md) |
| 1.9 | `parseStep` — JSON parse + fence stripping + schema validation | `src/engine/parseStep.ts` | Unit: valid JSON (all 4 step types), invalid JSON, fenced JSON, missing fields |
| 1.10 | `ToolRunner` — registry, allowlist check, validate, execute | `src/tools/ToolRunner.ts` | Unit: register, resolve, allowlist deny, validate fail, execute success/error |
| 1.11 | Built-in tools: `system_save_memory`, `system_get_memory` | `src/tools/builtins.ts` | Unit: each tool with mock `MemoryAdapter` |
| 1.12 | `EngineDeps`, `EngineHooks`, `LLMResponseMeta` types | `src/engine/types.ts` | Type-only |
| 1.13 | `ContextBuilder` | `src/context/ContextBuilder.ts` | Unit: deterministic output; tool catalog from agent + skills (+ registry). **`SecurityContext` on input type is unused in `build()`** — see [`technical-debt.md`](./technical-debt.md) §7 |
| 1.14 | `executeRun` — main loop (+ `createRun`) | `src/engine/Engine.ts` | Integration: thought→action→result cycle; wait→resume; max iterations; parse recovery (1 re-prompt then fail) |
| 1.15 | Define API: `Tool.define`, `Skill.define`, `Agent.define`, `Session`, **`Agent.load(agentId, runtime, { session })`** | `src/define/*.ts`, `src/runtime/AgentRuntime.ts` | Integration: **`new AgentRuntime({ … })`** → define→load→run with in-memory adapters |
| 1.16 | `watchUsage` helper | `src/engine/watchUsage.ts` | Unit: totals + **wasted** tokens when parse fails (`onLLMAfterParse`) |
| 1.17 | Barrel export | `src/index.ts` | Compile: all public types and classes importable |
| 1.18 | **`AgentRuntime`** (`EngineConfig`, merged **`runtime.config`**, **`registerRagCatalog(projectId, …)`** / **`ragCatalogForProject`**, optional **`fileReadRoot`**, **`allowedToolIds`**, **`sendMessageTargetPolicy`**) — **`registerRagCatalog(runtime, projectId, …)`** from **`@opencoreagents/rag`** delegates here | `src/runtime/AgentRuntime.ts`, `src/runtime/engineConfig.ts`, `src/ragCatalogTypes.ts` | Integration: explicit runtime per worker; public API has no global singleton |
| 1.19 | `RunBuilder`, `RunStore` wiring, `Agent.resume` | `src/define/RunBuilder.ts`, `src/adapters/run/*` | Integration: `wait` → persisted run → `resume` |
| 1.20 | `buildEngineDeps`, `effectiveToolAllowlist`, registry exports for workers | `src/engine/buildEngineDeps.ts`, `src/define/effectiveToolAllowlist.ts` | Integration: `executeRun` with deps built like `RunBuilder` |
| 1.21 | `RunBuilder.onWait` | `src/define/RunBuilder.ts` | Integration: in-process continuation after `wait` |

**Gate:** `pnpm turbo build --filter=@opencoreagents/core && pnpm turbo test --filter=@opencoreagents/core` — all green. A test runs a mock agent through thought→action→observation→result with `InMemoryMemoryAdapter` and a mock `LLMAdapter` that returns scripted steps.

---

## Persistence — two packages

For **memory**, **RunStore**, and **MessageBus**, use **`@opencoreagents/adapters-redis`** when you have a normal **TCP** `REDIS_URL` (Docker, Kubernetes, VMs, or Upstash’s TCP endpoint). That path aligns with **BullMQ** and typical production Redis and is the **default recommendation** for cluster deployments.

Use **`@opencoreagents/adapters-upstash`** when you want **HTTP-only** Redis (serverless/edge) or bundled **`UpstashVectorAdapter`**. Vector retrieval is hosted in that package today; swap `VectorAdapter` in app code if you use another backend.

---

## Phase 2 — Native TCP Redis (`packages/adapters-redis`)

**Goal:** Shared memory, run persistence, and multi-agent messaging over **`redis://…`** with **`ioredis`**. Same **key/stream layout** as the Upstash HTTP adapters so you can switch transports without changing engine code.

**Package:** `packages/adapters-redis` (in workspace)

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 2.1 | Monorepo scaffold | `package.json`, `tsconfig.json`, `tsup.config.ts`, `workspace:*` → `@opencoreagents/core` | `pnpm turbo build --filter=@opencoreagents/adapters-redis` |
| 2.2 | Key builder (`memoryKeyPrefix`) | `src/keys.ts` | Same prefix as Upstash memory adapter |
| 2.3 | `RedisMemoryAdapter` | `src/RedisMemoryAdapter.ts` | Unit (`ioredis-mock`) |
| 2.4 | `RedisRunStore` | `src/RedisRunStore.ts` | Unit (`ioredis-mock`) |
| 2.5 | `RedisMessageBus` (Streams, same keys as Upstash bus) | `src/RedisMessageBus.ts` | Unit (mocked `xadd` / `xrange` / `xtrim`) |
| 2.6 | Barrel export | `src/index.ts` | — |

**Deps:** `ioredis` (implemented); `node-redis` alternative left to future if needed.

**Gate:** `pnpm turbo build && pnpm turbo test --filter=@opencoreagents/adapters-redis` — green. No new `workspace:*` dependency from `@opencoreagents/core` to this package (adapters depend on core only).

---

## Phase 2a — Upstash REST (`packages/adapters-upstash`)

**Goal:** Memory (and optional run store / message bus / vector) via **Upstash HTTP** — useful when you do not want a long-lived TCP connection or when you standardize on Upstash’s REST API and **Upstash Vector**.

**Package:** `packages/adapters-upstash`

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 2a.1 | Memory key prefix matches TCP Redis: `m:{projectId}:{agentId}:{sessionId}:eu:{endUserId}:…` when `endUserId` is set, else `…:sess:…` ([`adapters-redis` `memoryKeyPrefix`](../packages/adapters-redis/src/keys.ts)) | `src/index.ts` (`UpstashRedisMemoryAdapter`) | Same contract as **`adapters-redis`** |
| 2a.2 | `UpstashRedisMemoryAdapter` implementing `MemoryAdapter` (LIST-backed append + legacy STRING migration) | `src/index.ts` | Unit: mocked `fetch` / REST command array. Integration (real Upstash, optional): round-trip |
| 2a.3 | `UpstashRunStore`, `UpstashRedisMessageBus`, `UpstashVectorAdapter` | `src/UpstashRunStore.ts`, `src/UpstashRedisMessageBus.ts`, `src/index.ts` (vector) | Unit: mocked `fetch` — see `packages/adapters-upstash/tests/` |
| 2a.4 | Shared REST helper for memory lists | `src/upstashMemoryList.ts` | Used by memory adapter |
| 2a.5 | Barrel export | `src/index.ts` | — |

**Deps:** none beyond `core` (adapters use **`fetch`** to Upstash REST — no `@upstash/redis` package in this workspace).

**Gate:** `pnpm turbo build && pnpm turbo test --filter=@opencoreagents/adapters-upstash` — builds after `core` (via `^build`), all tests green.

---

## Phase 3 — LLM provider (OpenAI)

**Goal:** Real LLM calls work. Error classification is stable.

**Package:** `packages/adapters-openai`

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 3.1 | `OpenAILLMAdapter` + `OpenAIEmbeddingAdapter` — maps `LLMRequest` to OpenAI HTTP API (`fetch`); chat maps **`finish_reason`** → **`LLMResponse.finishReason`**; embeddings: optional **`signal`**, **`fetchTimeoutMs`**, **`dimensions`**, or string `baseUrl` as third ctor arg | `src/index.ts` | Unit (HTTP mocks): request mapping, **`finish_reason`**, **`usage`**, embedding timeouts / dimensions |
| 3.2 | Error mapping: 429 → `LLMRateLimitError`, 5xx → `LLMTransportError`, 4xx → `LLMClientError` | `src/errors.ts` (chat + embeddings) | Unit: status → correct error class |
| 3.3 | Barrel export | `src/index.ts` | — |

**Deps:** none (uses native `fetch`; optional OpenAI SDK not required).

**Gate:** Unit tests with mocked `fetch` pass. Optional integration test (CI-only, `OPENAI_API_KEY`): **`new AgentRuntime({ llmAdapter, memoryAdapter })`** → **`Agent.load(..., runtime, { session })`** → **`agent.run("hello")`** → valid `result` step.

---

## Phase 4 — Hooks + hardening

**Goal:** Runs are safe — bounded by time and iterations, cancellable via `AbortSignal`.

**Package:** `packages/core`

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 4.1 | Hook wiring: `onThought`, `onAction`, `onObservation`, `onWait`, `onLLMResponse`, `onLLMAfterParse` fire at correct points | `src/engine/Engine.ts` | Integration: mock hooks verify call order and arguments |
| 4.2 | Global run timeout (`runTimeoutMs`) → `RunTimeoutError` | `Engine.ts` | Integration: slow mock LLM triggers timeout |
| 4.3 | Per-tool timeout in `ToolRunner` → error observation | `ToolRunner.ts` | Unit: slow mock tool triggers timeout |
| 4.4 | `AbortSignal` propagation to LLM adapter and long tools | `Engine.ts` | Integration: external abort → `RunCancelledError` |

**Gate:** All existing tests still pass. New timeout/abort tests pass. Hooks verified in isolation and integration.

---

## Phase 5 — Job queue (**BullMQ first**)

**Goal:** Runs execute in background workers with retries and DLQ. **BullMQ on Redis** is the **primary** supported pattern; QStash remains an optional HTTP-callback alternative (not packaged here).

**Status:** **`packages/adapters-bullmq`** provides **`createEngineQueue`** and **`createEngineWorker`**. **`dispatchEngineJob`** and typed **`EngineJobPayload`** (`run` / `resume`) are implemented in **`packages/core`** and **re-exported** from **`adapters-bullmq`**. Workers still call the same engine entry points as the SDK (`Agent.run` / `Agent.resume` via `dispatchEngineJob`, or `buildEngineDeps` + `executeRun` for lower-level control). See `docs/core/19-cluster-deployment.md` §4.

| Step | Module | Notes | Test |
|------|--------|-------|------|
| 5.1 | BullMQ helpers — queue + worker; `dispatchEngineJob` in **`core`**, re-exported from **`adapters-bullmq`** | `packages/adapters-bullmq/`, `packages/core/src/engine/dispatchJob.ts` | Unit: `dispatchEngineJob` with in-memory config; CI: `redis-queue.integration.test.ts` with Redis service + `REDIS_INTEGRATION=1` |
| 5.2 | Delayed jobs for `wait` with `reason: scheduled` | App enqueues **`addResume`** with `delay` / separate queue — not wrapped in-package | Documented pattern |
| 5.3 | QStash alternative (HTTP callback to `POST /runs/:id/resume`) | Optional | Not in monorepo |

**Gate:** **`pnpm turbo test --filter=@opencoreagents/adapters-bullmq`** passes. A worker using **`createEngineWorker`** + **`dispatchEngineJob(runtime, job.data)`** (payload must satisfy **`EngineJobPayload`**, same shape you enqueue) after **`AgentRuntime`** + **`Agent.define`** can process `run` jobs end-to-end in a real deployment (your Redis + bootstrap).

---

## Phase 6 — RAG pipeline

**Goal:** Agents can search, ingest, and manage a vector knowledge base.

### 6a — Utils (`packages/utils`)

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 6a.1 | `parseFile` dispatcher + txt/md/json parsers | `src/parsers/` | Unit: each format → `ParseResult` |
| 6a.2 | `chunkText` dispatcher + `recursive` strategy | `src/chunking/` | Unit: token counts, overlap, boundary handling |
| 6a.3 | `resolveSource` — local paths, HTTP URLs | `src/file-resolver/` | Unit: mock fs/fetch |
| 6a.4 | Barrel export | `src/index.ts` | — |

### 6b — Adapter interfaces + implementations

| Step | Module | Package | Test |
|------|--------|---------|------|
| 6b.1 | `EmbeddingAdapter` interface | `core/src/adapters/embedding/` | Type-only |
| 6b.2 | `OpenAIEmbeddingAdapter` | `adapters-openai/src/` | Unit (HTTP mock): embed/embedBatch, dimensions |
| 6b.3 | `VectorAdapter` interface + types | `core/src/adapters/vector/` | Type-only |
| 6b.4 | `UpstashVectorAdapter` | `adapters-upstash/src/` | Unit (mock): upsert/query/delete |

### 6c — Tools and skills

| Step | Module | Package | Test |
|------|--------|---------|------|
| 6c.1 | `system_vector_search`, `system_vector_upsert`, `system_vector_delete` tools | `core/src/tools/` | Integration: mock embedding + vector adapters |
| 6c.2 | `system_file_read`, `system_file_ingest`, `system_file_list` tools | `rag/src/tools/` | Integration: mock utils + adapters, full pipeline |
| 6c.2b | **`system_list_rag_sources`**, **`system_ingest_rag_source`**; **`registerRagToolsAndSkills()`**; **`registerRagCatalog(runtime, projectId, entries)`** (`@opencoreagents/rag`); per-project catalog on **`AgentRuntime`** (`validateRagFileCatalog`, `ragCatalogForProject`) | `rag/src/`, `core/src/runtime/AgentRuntime.ts`, `core/src/ragCatalogTypes.ts` | Integration: catalog + ingest + search; **`examples/rag`** |
| 6c.3 | `rag` and `rag-reader` skills | `rag/src/skills/` | Unit: tool grouping, description |
| 6c.4 | `SkillDefinitionPersisted`, `Skill.define(def, execute?)`, `Skill.defineBatch` (Redis/DB JSON + code `execute`) | `core/src/define/Skill.ts` | Unit: `tests/skill-define.test.ts` |

**Gate:** `pnpm turbo build` builds all packages in topological order. Integration test: `system_file_ingest` a `.md` file → `system_vector_search` returns relevant chunks. Catalog path: register tools → **`registerRagCatalog(runtime, projectId, [...])`** → **`system_ingest_rag_source`** by id (see **`examples/rag`**).

---

## Phase 7 — Multi-agent

**Goal:** Two agents can coordinate via `system_send_message` + `wait`/`resume`.

**Package:** `packages/core`

| Step | Module | File(s) | Test |
|------|--------|---------|------|
| 7.1 | `AgentMessage`, `MessageBus` interfaces | `src/bus/MessageBus.ts` | Type-only |
| 7.2 | In-process `MessageBus` (EventEmitter + Map) | `src/bus/InProcessMessageBus.ts` | Unit: send/waitFor with correlationId, timeout |
| 7.3 | `system_send_message` tool | `src/tools/sendMessage.ts` (+ `sendMessagePolicy.ts`) | Unit: enqueues via bus, returns `{ success, messageId }`; policy tests in **`send-message-validation.test.ts`** |
| 7.4 | Request–reply integration: Agent A → send → wait → Agent B → reply → A resumes | `Engine.ts` | **`tests/multi-agent.test.ts`** — `system_send_message` + `InProcessMessageBus` (event + **`correlationId`** request). Full **two-agent run** with **`wait`/`resume`** across processes is orchestration outside `core`. |

**Gate:** **`multi-agent.test.ts`** passes (delivery + correlation). Optional follow-up: scripted two-agent **`wait`/`resume`** loop in tests or sample app — not required for the Phase 7 **MessageBus** + tool contract.

---

## Phase 8 — CLI + scaffold

**Goal:** `npx @opencoreagents/cli init my-project` generates a working project.

| Step | Module | Package | Test |
|------|--------|---------|------|
| 8.1 | Programmatic scaffold API: `initProject`, `generateAgent`, `generateTool`, `generateSkill` | `packages/scaffold` | Unit: returns file manifest with correct paths |
| 8.2 | Programmatic templates: `default`, `minimal`, `multi-agent` | `packages/scaffold/src/templates/*.ts` | — |
| 8.3 | CLI commands: `init`, `generate agent`, `generate tool`, `generate skill` | `packages/cli/src/commands/` | Integration (temp dirs): generated files exist, compile, contain expected content |
| 8.4 | Post-scaffold checklist output | `packages/cli/` | Snapshot test |

**Gate:** `npx @opencoreagents/cli init test-project --template default` → `cd test-project && pnpm install && pnpm build` succeeds. Generated agent definition is valid.

---

## Phase 9 — Integration hardening

**Goal:** End-to-end confidence across the full stack.

| Step | What | Verify |
|------|------|--------|
| 9.1 | End-to-end: define tools + skills + agent → **`new AgentRuntime({ memoryAdapter, llmAdapter, … })`** → **`Agent.load(..., runtime, { session })`** → run with **TCP Redis** (`adapters-redis`) or Upstash REST + OpenAI | Full cycle completes, memory persists across runs |
| 9.2 | End-user session: `endUserId` scoping — `longTerm` keyed by user, `shortTerm` by session | **`tests/memory-scope.test.ts`** — **`InMemoryMemoryAdapter`**; **TCP/Upstash** adapters still use one key prefix per scope (see `technical-debt`) |
| 9.3 | `watchUsage` in production-like run — verify token accumulation, `organizationId`/`projectId` present | **`tests/watch-usage.test.ts`** — totals, **wasted** (recoverable + **fatal** **`StepSchemaError`**), **`getUsage()`** after run/reject |
| 9.4 | Security: define with `end_user` principal fails; run with wrong `projectId` fails | **`SecurityError`** exists but is **not thrown** in core yet — enforce in host layer; see [`technical-debt.md`](./technical-debt.md) §7 |
| 9.5 | Error resilience: LLM returns garbage → 1 re-prompt → valid step OR `StepSchemaError` | **`tests/parse-recovery.test.ts`** — recovery success + **`StepSchemaError`** when recovery exhausted |
| 9.6 | Timeout: global run timeout triggers `RunTimeoutError`, abort triggers `RunCancelledError` | **`tests/runtime-limits.test.ts`** — `startedAtMs` in the past vs **`runTimeoutMs`**; **`AbortSignal`** already aborted |
| 9.7 | RAG catalog: **`validateRagFileCatalog`**, **`AgentRuntime.registerRagCatalog`**, **`ragCatalogForProject`** → **`buildEngineDeps`** | **`tests/rag-file-catalog.test.ts`** |
| 9.8 | Vector tools: request size / batch caps (`vectorLimits`) | **`tests/vector-limits.test.ts`** |
| 9.9 | `system_send_message`: target allowlist / policy (`sendMessageTargetPolicy` on **`AgentRuntime`**) | **`tests/send-message-validation.test.ts`** |
| 9.10 | Tool failure → observation (engine does not stall on bad tool output) | **`tests/tool-failure-observation.test.ts`** |
| 9.11 | **`RunStore`** persistence contract (in-memory reference + integration expectations) | **`tests/run-store.test.ts`** |

**Gate:** All integration tests green in CI. No `core` package depends on any adapter package (`workspace:*` deps only flow outward).

---

## Dependency graph (build order)

```
                    ┌──────────┐
                    │   core   │  ← no workspace deps
                    └────┬─────┘
          ┌──────────────┼──────────────┬────────────────┬────────────────┬───────────────┐
          ▼              ▼              ▼                ▼                ▼               ▼
  ┌────────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ adapters-redis │ │adapters-upstash│ │adapters-bullmq│ │  utils   │ │ scaffold │ │adapters-openai│
  └────────────────┘ └───────────────┘ └───────────────┘ └────┬─────┘ └────┬─────┘ └──────────────┘
                         │                              │
                         ▼                              ▼
                    ┌──────────┐                   ┌──────────┐
                    │   rag    │                   │   cli    │
                    └──────────┘                   └──────────┘
```

`adapters-redis`, `adapters-upstash`, and **`adapters-bullmq`** sit in the same layer (depend only on `core`). **`dynamic-definitions`** depends on **`core`** + **`adapters-http-tool`** (and is loaded at runtime by **`core`** via dynamic `import()` when **`dynamicDefinitionsStore`** is set — not a `core` `package.json` dependency). **BullMQ** uses Redis TCP — pair with **`adapters-redis`** for shared `REDIS_URL` when it fits your topology.

---

## Quick reference: success criteria per phase

| Phase | I know it works when… |
|-------|----------------------|
| 0 | `pnpm turbo build` compiles all **fourteen** workspace packages (`adapters-redis`, **`adapters-bullmq`**, **`dynamic-definitions`**, **`rest-api`**, …) |
| 1 | **`AgentRuntime`** + mock LLM: thought→action→result with in-memory adapters |
| 2 | `RedisMemoryAdapter` / `RedisRunStore` / `RedisMessageBus` + `ioredis` — data and runs survive restart on TCP Redis |
| 2a | Same persistence story with `UpstashRedisMemoryAdapter` (REST) when you choose Upstash instead of TCP |
| 3 | Same test passes with real OpenAI, `watchUsage` reports tokens |
| 4 | Global `runTimeoutMs` + optional per-tool `toolTimeoutMs` (`ToolTimeoutError`); `AbortSignal` cancels run cleanly |
| 5 | **`@opencoreagents/adapters-bullmq`**: `createEngineQueue` / `createEngineWorker`; **`dispatchEngineJob(runtime, payload)`** (**`@opencoreagents/core`**, re-exported) — jobs complete asynchronously on workers |
| 6 | `system_file_ingest` / **`system_ingest_rag_source`** → **`system_vector_search`** returns chunks; optional declarative catalog via **`registerRagCatalog(runtime, …)`** |
| 7 | Agent A asks Agent B a question, gets an answer back |
| 8 | `npx @opencoreagents/cli init` produces a buildable project |
| 9 | Full stack + **`AgentRuntime`** on workers; host-layer security (**§9.4** gaps in core); usage tracking via **`watchUsage`** / hooks; **§9.7–9.11** tests (**`rag-file-catalog`**, **`vector-limits`**, **`send-message-validation`**, **`tool-failure-observation`**, **`run-store`**) |
