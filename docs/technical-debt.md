# Technical debt and known gaps

English-language register of **intentional deferrals**, **plan vs implementation gaps**, and **follow-up work** for the `@agent-runtime` monorepo. It complements [`plan.md`](./plan.md) (roadmap) and [`core/19-cluster-deployment.md`](./core/19-cluster-deployment.md) (cluster patterns).

**Snapshot:** Automated **CI** (`build` / `test` / `lint` on every push/PR) with a **Redis** service and **`REDIS_INTEGRATION=1`** for BullMQ integration — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). **Per-tool timeout** (`toolTimeoutMs` on **`AgentRuntime`**, `ToolTimeoutError`), **session expiry** (`SessionOptions.expiresAtMs`, `SessionExpiredError` on **`run` / `resume` / `onWait`**), and **per-project RAG catalog** (`AgentRuntime.registerRagCatalog` / `@agent-runtime/rag`) are **implemented**. Runtime wiring is explicit: **`new AgentRuntime({ … })`** + **`Agent.load(agentId, runtime, { session })`** / **`dispatchEngineJob(runtime, payload)`** (no global runtime singleton). **Phase 9** has **broad automated coverage** in **`packages/core/tests`** (memory scope, parse recovery, runtime limits, hooks, multi-agent, rag catalog, vector caps, system_send_message policy, tool-failure observations, run-store, runtime allowlist, etc.) — see [`plan.md` — Progress snapshot](./plan.md); **still manual / optional:** full-stack **9.1** with **real OpenAI + TCP Redis** in CI, and **host-layer** checks for **§9.4**-style security stories. **Docs:** prompt tool visibility = **`effectiveToolAllowlist`**; **`SecurityContext` is not used inside `ContextBuilder.build()`** to hide tools yet ([`08-scope-and-security.md`](./core/08-scope-and-security.md) §2, [`11-context-builder.md`](./core/11-context-builder.md) §3). This file focuses on what remains. **Multi-worker races**: **§8**; **security / integrity gaps**: **§7**; **RAG example + OpenAI adapter** (durable vector, embedding timeouts/retries, `finish_reason`): **§1**, **§3**, **§6**, **§9**; **open source / community** (license, contributing, security policy): **§10**.

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
| **Memory keys: `longTerm` + Redis/Upstash** | **`InMemoryMemoryAdapter`** partitions **`longTerm`** / **`vectorMemory`** by **`endUserId`** when set (matches [15-multi-tenancy.md](./core/15-multi-tenancy.md) §4.3). **`RedisMemoryAdapter`** / **`UpstashRedisMemoryAdapter`** still use **`memoryKeyPrefix(scope)`** (includes **`sessionId`**) for **all** memory types — cross-session **`longTerm`** for the same end-user may require a follow-up key layout change. |
| **`@agent-runtime/rag` + `examples/rag`** | Per-project catalog: **`registerRagCatalog(runtime, projectId, sources)`** from **`@agent-runtime/rag`** (or **`AgentRuntime.registerRagCatalog`**) after **`registerRagToolsAndSkills()`**. **`fileReadRoot`** can default on **`AgentRuntime`** (session overrides). **`examples/rag`** uses **`createDemoVectorAdapter()`** (in-memory, single-process) and permissive demo **`security.roles`** — **not** production. Ship a **durable** **`VectorAdapter`**, explicit embedding model + **dimensions** config, and minimal roles for real traffic. |

---

## 2. Core engine (`packages/core`)

| Item | Notes |
|------|--------|
| **Dedicated `hooks.ts` module** | The plan references `src/engine/hooks.ts`; hooks are wired inside [`Engine.ts`](../packages/core/src/engine/Engine.ts) instead. Low priority unless hook surface grows. |
| **Hook + usage tests** | **`hooks.test.ts`** — hook order incl. **`onLLMAfterParse`**. **`watch-usage.test.ts`** — **`watchUsage`** totals + **wasted** tokens (incl. fatal **`StepSchemaError`** path). |
| **Allowlist + session + RAG + vector + system_send_message + tool failures** | **`runtime-tool-allowlist.test.ts`**, **`session-expiry.test.ts`**, **`rag-file-catalog.test.ts`**, **`vector-limits.test.ts`**, **`send-message-validation.test.ts`**, **`tool-failure-observation.test.ts`**, **`run-store.test.ts`** — see **`plan.md`** Phase **9** steps **9.7–9.11** and Progress snapshot. |
| **Resolved engine config** | **`AgentRuntime.config`** exposes merged **`EngineConfig`** (limits, adapters, optional **`allowedToolIds`**, **`sendMessageTargetPolicy`**, **`fileReadRoot`**, …). There is no separate **`getEngineConfig()`** in the public API — workers/tests should hold a **`AgentRuntime`** (or spread **`runtime.config`** when assembling custom **`EngineDeps`**). |
| **`executeRun` iteration vs parse recovery** | **Documented** in [`03-execution-model.md`](./core/03-execution-model.md) §**Iteration counter and parse recovery** — `maxIterations` vs parse-recovery `continue`, and **`wait`/`result`** not incrementing **`iteration`**. |
| **`parseStep` / step payload strictness** | Validates `type` and minimal required fields, then casts the object to `Step`; `action.input` and extra JSON keys are unconstrained — acceptable for flexibility; add schema validation or strip unknown keys if stricter contracts or safer logging are needed. |

---

## 3. Testing and CI

| Item | Notes |
|------|--------|
| **Phase 9 (integration hardening)** | **Automated (CI):** **`memory-scope`**, **`parse-recovery`**, **`runtime-limits`**, **`watch-usage`**, **`hooks`**, **`multi-agent`**, **`rag-file-catalog`**, **`vector-limits`**, **`send-message-validation`**, **`tool-failure-observation`**, **`run-store`**, **`runtime-tool-allowlist`**, **`session-expiry`**, plus existing **`engine`** / adapter suites. **Still partial / manual:** E2E **9.1** (define → **`AgentRuntime`** → load → run against **real OpenAI + TCP Redis**) not required in CI; **9.2** parity tests for **`longTerm`** keys on **TCP/Upstash** memory adapters (see **§1** memory keys row); **9.4** — **`SecurityError`** exists but is **not thrown** in core (host policy; **§7**). See [`plan.md` §Phase 9](./plan.md). |
| **`@agent-runtime/adapters-openai`** | HTTP status → typed errors; failed `fetch` (network) → `LLMTransportError`; `AbortError` → `RunCancelledError` ([`errors.ts`](../packages/adapters-openai/src/errors.ts)). **`OpenAILLMAdapter`** maps API **`choices[0].finish_reason`** to **`LLMResponse.finishReason`** (fallback **`stop`**). **`OpenAIEmbeddingAdapter`**: optional third arg remains a **`baseUrl`** string, or pass **`OpenAIEmbeddingAdapterOptions`** — **`signal`**, **`fetchTimeoutMs`** (internal abort + `setTimeout`), explicit **`dimensions`**, or **`baseUrl`**; after each successful batch, **`dimensions`** is updated from the first vector length unless **`dimensions`** was set in options. Malformed JSON in success bodies is still a rare unwrapped parse error. **Remaining gaps:** no automatic retry/backoff for **429** / transient **5xx**; embedding **`dimensions`** metadata from the API (if OpenAI adds it) is not read separately from vector length. |
| **Multi-agent request–reply** | **`packages/core/tests/multi-agent.test.ts`** covers **`InProcessMessageBus`** + **`system_send_message`** (event delivery + **`correlationId`** on requests). A full **two-run** cycle (A request → B processes → B reply → A resumes) remains app/orchestrator glue, not duplicated in `core`. |

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
| **REST / MCP product APIs** | [14-consumers.md](./core/14-consumers.md) describes patterns; there is no reference HTTP server in this repo. Roadmaps: [`plan-rest.md`](./plan-rest.md), [`plan-mcp.md`](./plan-mcp.md). |
| **`docs/scaffold.md` size** | Very long single file — fine as reference; for ongoing changes, splitting or doc-only PRs can ease review. |

---

## 6. Operations and runtime

| Item | Notes |
|------|--------|
| **Graceful shutdown** | [19-cluster-deployment.md §8](./core/19-cluster-deployment.md) describes waiting for in-flight `executeRun`; not enforced by a built-in supervisor. |
| **Observability** | No standard OpenTelemetry or structured logging in core — apps integrate their own. |
| **Embedding / vector HTTP** | Core **`vectorLimits`** cap tool args. **`OpenAIEmbeddingAdapter`** supports **`fetchTimeoutMs`** / **`signal`**; **retries** and **cost** alerts remain app-level for all providers. |

---

## 7. Security, integrity, and production readiness

Audit-style gaps (2026-04); the **core** assumes a trusted **host** (API/BFF) for real auth unless extended below. Docs describe **SecurityLayer** before the engine; **enforcement** in `packages/core` is **agent + skills (+ optional `AgentRuntime.allowedToolIds`) tool allowlists**, not principal-scoped authZ. Canonical narrative: [08-scope-and-security.md](./core/08-scope-and-security.md) §2–§3.

| Item | Notes |
|------|--------|
| **`SecurityContext` unused in `ContextBuilder` / `ToolRunner`** | [`ContextBuilder.build`](../packages/core/src/context/ContextBuilder.ts) does not read **`input.securityContext`** — prompt tools come from **agent/skills ∩ registry** (+ optional **`AgentRuntime.allowedToolIds`** via deps), not from principal scopes. **[`ToolRunner`](../packages/core/src/tools/ToolRunner.ts)** does not read **`securityContext`** for role checks. **`SecurityContext`** is still passed on **`ToolContext`** for tools that need it. Canonical explanation: [`08-scope-and-security.md`](./core/08-scope-and-security.md) §2, [`11-context-builder.md`](./core/11-context-builder.md) §3. |
| **`SecurityError` never thrown** | [`SecurityError`](../packages/core/src/errors/index.ts) is exported but no core path raises it — policy must live in the app layer or be wired into builder/runner. |
| **Default `scopes: ["*"]` in `securityContextForAgent`** | [`buildEngineDeps`](../packages/core/src/engine/buildEngineDeps.ts) sets `scopes: agent.security?.scopes ?? ["*"]` and `kind: "internal"`. Fine for **embedded** use; **unsafe** if mistaken for end-user JWT-derived context — hosts should pass an explicit context once a public API exists. |
| **Tool failure messages leaked to the LLM** | **Mitigated (not full logging story):** [`observationForToolFailure`](../packages/core/src/engine/toolFailureObservation.ts) maps **`ToolExecutionError`** and unknown errors to a generic message + **`code`**; **`ToolTimeoutError`** uses generic text. **`ToolNotAllowedError`** / **`ToolValidationError`** still expose engine-authored messages (no raw third-party strings). Emit full errors in **`onObservation`** server-side if you log there, or add a dedicated hook later. |
| **`system_send_message` validation and policy** | **Mitigated in core:** same structural checks as above, plus optional **`sendMessageTargetPolicy`** on **`AgentRuntime`** ([`engineConfig.ts`](../packages/core/src/runtime/engineConfig.ts) / [`sendMessagePolicy.ts`](../packages/core/src/tools/sendMessagePolicy.ts)) — return **`false`** to deny a destination; wired through **`ToolContext`** from [`Engine.ts`](../packages/core/src/engine/Engine.ts). Hosts using **`ToolRunner`** alone must set **`sendMessageTargetPolicy`** on each **`ToolContext`** if they need the same guard without the full engine. |
| **`system_file_read` / `resolveSource` (LFI + SSRF)** | [`packages/utils` file-resolver](../packages/utils/src/file-resolver/index.ts): arbitrary local paths (`readFile`) and any `http(s)` `fetch` without host allowlist or SSRF guards. **Do not** expose unchanged to untrusted agents in production. |
| **Resume without `sessionId` binding** | **Mitigated when `Run.sessionId` is set** (normal **`createRun`** path): [`RunBuilder`](../packages/core/src/define/RunBuilder.ts) rejects resume if **`loaded.sessionId !== session.id`**. Runs with **`sessionId` omitted** skip the check — avoid omitting for multi-tenant HTTP; consider persisting **`projectId`** on **`Run`** for an extra guard. |
| **`RedisRunStore` / `UpstashRunStore` JSON load** | `JSON.parse` → cast to `Run` without structural validation; compromised or malformed store data feeds the engine. Prefer schema validation + tenant **key prefixes** on Redis (see also §1 MessageBus keys). |
| **Tool `roles` on definitions** | JSON `roles` on tool definitions are not enforced by **`ToolRunner`** (allowlist is agent/skills only). OK if documented as metadata; misleading if read as runtime RBAC. |
| **Vector tools (`system_vector_search` / upsert / delete)** | **Partially mitigated:** [`vectorLimits.ts`](../packages/core/src/tools/vectorLimits.ts) caps **`topK`**, upsert batch size, and **`system_vector_delete`** **`ids`** length; **`system_vector_search`** / **`system_vector_upsert`** / **`system_vector_delete`** use **`validate`** (delete requires non-empty **`ids`** and/or non-empty **`filter`**). Provider **`filter`** on search/delete is still model-controlled — validate or strip in the app if the backend is sensitive. |
| **Demo / example agents (`security.roles`)** | Examples and scaffolds may use **broad** role lists for convenience — **not** a production RBAC template; hosts must assign **minimal** roles per tenant (see **§9**). |
| **Multiple `AgentRuntime` instances / drift** | Each **`AgentRuntime`** holds its own merged config. Built-in handler registration is **idempotent** at the process level, but a **misconfigured** worker in a fleet (wrong `llmAdapter`, missing `runStore`) still diverges from peers — treat bootstrap as **release-gated** (same env, health checks). |
| **`EngineJobPayload` and session expiry** | Optional **`expiresAtMs`** on run/resume payloads: [`dispatchEngineJob`](../packages/adapters-bullmq/src/dispatch.ts) throws **`EngineJobExpiredError`** when `Date.now()` exceeds it. Map that to a **non-retryable** BullMQ failure in the worker if jobs can sit in the queue past the session window. |
| **Parse recovery exposes raw LLM text** | [`Engine.ts`](../packages/core/src/engine/Engine.ts) may inject up to **4000** chars of failed model output into the next turn — can contain **secrets or PII** if the model echoed them; log/redact in regulated environments. |
| **Scaffold `writeTextFile` path hardening** | [`fs-utils.ts`](../packages/scaffold/src/fs-utils.ts) rejects relative paths containing **`..`** (`assertProjectRelativeSafe`). Malicious **`generate`** ids are still constrained mainly by id normalization — prefer alphanumeric ids in automation. |

**Mitigations outside this repo (typical):** authenticate at the edge; map JWT → `SecurityContext`; never use `securityContextForAgent` semantics for external principals; sandbox or remove dangerous tools; Redis ACL + TLS; rate limits and run quotas.

---

## 8. Multi-worker concurrency and integrity

What happens when **several workers** share **Redis RunStore**, **memory**, and **queues** — the core and bundled adapters **do not** provide distributed locking or atomic state machines beyond what Redis/BullMQ offer implicitly.

| Item | Notes |
|------|--------|
| **`RunStore` resume races** | **Mitigated on bundled stores:** [`RunStore.saveIfStatus`](../packages/core/src/adapters/run/RunStore.ts) + [`RunBuilder`](../packages/core/src/define/RunBuilder.ts) use it after **`Agent.resume`** and after in-process **`onWait`** continuations when the last persisted row was **`waiting`**. [`RedisRunStore`](../packages/adapters-redis/src/RedisRunStore.ts) uses **`WATCH`/`MULTI`/`EXEC`**; [`UpstashRunStore`](../packages/adapters-upstash/src/UpstashRunStore.ts) uses a single **`EVAL`** (REST cannot `WATCH` across requests). A losing worker gets **`RunInvalidStateError`**. Custom **`RunStore`** implementations must implement **`saveIfStatus`** coherently; plain **`save`** is still used for the **first** persist of a new run. Still pair with BullMQ **`jobId`** dedupe where possible. |
| **Duplicate BullMQ jobs** | [`dispatchEngineJob`](../packages/adapters-bullmq/src/dispatch.ts) has no idempotency key inside the engine. Enqueuing the same **`resume`** twice → two workers may process — pairs with **`RunStore`** race above. Use BullMQ **`jobId`** (deterministic per `runId`+resume token) or “at most once” dequeue patterns in the app. |
| **`RedisMemoryAdapter` / `UpstashRedisMemoryAdapter.save` — legacy migration race** | **Fixed for normal use:** append uses Redis **LIST** + **`RPUSH`** (atomic per entry) — [`memoryListSave.ts`](../packages/adapters-redis/src/memoryListSave.ts), [`upstashMemoryList.ts`](../packages/adapters-upstash/src/upstashMemoryList.ts). **Legacy** keys that still hold a STRING (JSON array) are migrated to LIST on first write; **two workers** hitting the same legacy STRING at once can still race during migration — flush or single-thread migrate those keys once after upgrade. |
| **`EngineJobPayload` and B2B2C** | **`endUserId`** is now optional on both run and resume payloads; [`dispatchEngineJob`](../packages/adapters-bullmq/src/dispatch.ts) passes it into **`Session`**. Producers must still set it when jobs represent an end-user (same as the SDK session). |
| **Same run, different workers, `ContextBuilder` / registry** | Already in [19-cluster-deployment.md §1.1](./core/19-cluster-deployment.md): definitions and **`AgentRuntime`** wiring must match on every node; otherwise two workers may expose different tools or LLM config for logically the “same” deployment. |
| **In-process only: `InMemoryRunStore` / `InMemoryMemoryAdapter`** | Safe for **one** Node process; **undefined** if multiple processes point at them — no shared state. |

**Doc pointer:** [19-cluster-deployment.md §3.4](./core/19-cluster-deployment.md) summarizes **`RunStore`** + memory races for operators.

---

## 9. Production architecture checklist (host / operator)

Use this when wiring **HTTP API**, **workers**, and **shared Redis**. The engine is a **library**; most controls live **outside** `packages/core`.

| Layer | Verify |
|-------|--------|
| **Identity** | No public route calls **`Agent.load(agentId, runtime, { session })`** without authenticating the caller and resolving **organization → `projectId`** (and **`endUserId`** for B2B2C). **`AgentRuntime`** construction must also sit behind the same trust boundary. |
| **Session ↔ run** | On **`resume`**, use the same tenant **`Session`** as create; when **`Run.sessionId`** was set at create, core **rejects** resume if **`session.id`** does not match (**§7**). If **`sessionId`** was omitted on the run, enforce binding in the host layer. |
| **Secrets** | API keys for LLM / Redis / vector live in **env** or a secret manager; never in agent JSON or prompts. |
| **RAG / vectors** | Use a **durable** vector store and **stable** embedding model + dimension config; do not rely on in-memory demo adapters or model-name heuristics for dimensions in production. |
| **Tools** | Disable or wrap **`system_file_*`**, other **`system_*`** surface you do not need, raw HTTP tools, and unrestricted **`system_send_message`** for untrusted tenants; cap vector **`topK`** and **`runTimeoutMs`**. |
| **Errors to the model** | Map tool failures to **generic** observations in production; keep **`e.message`** in server logs only (**§7**). |
| **Cluster** | Identical **bootstrap** on every worker; **`RunStore`** + **BullMQ `jobId`** for resume idempotency; Redis **TLS** + **ACL**; see **§8**. |
| **Observability** | Correlate **`runId`** / **`projectId`** in logs; alert on **`failed`** runs and LLM **rate limits**. |

Canonical narrative: [08-scope-and-security.md §7](./core/08-scope-and-security.md) (production checklist). Gap register: **§7–§8** in this file; architecture table: **§9**.

---

## 10. Open source and community

Items expected for a **public** OSS project (adoption, legal clarity, responsible disclosure). **CI** is already in place ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)); the rest is **not** a substitute for **§7** / **§9** (runtime security stays in the host).

| Item | Notes |
|------|--------|
| **Root `LICENSE`** | No canonical license file at repo root yet — add one (e.g. MIT, Apache-2.0) before publishing as OSS; match **SPDX** id in published packages. |
| **`license` in `package.json`** | Workspace packages should declare **`"license"`** (and keep **private** vs **publish** flags consistent) for anything shipped to **npm** or other registries. |
| **`CONTRIBUTING.md`** | How to clone, **`pnpm install`**, **`build` / `test` / `lint`**, branch/PR expectations, scope of the monorepo — lowers friction for external contributors. |
| **`SECURITY.md`** | Vulnerability reporting path (e.g. GitHub **Security** → **Advisories**, or a dedicated security contact); separate from [`08-scope-and-security.md`](./core/08-scope-and-security.md) (engine semantics). |
| **`CODE_OF_CONDUCT.md`** | Optional but standard for community-run repos (e.g. Contributor Covenant). |
| **Releases and semver** | **`CHANGELOG.md`** and/or GitHub **Releases** when publishing versioned packages; align with **§1** adapter/API stability expectations. |
| **Issue / PR templates** | Optional: bug vs feature, Node/pnpm versions — reduces incomplete reports. |

---

## How to use this document

- **Triaging:** Prefer turning items into tracked issues with owners.
- **Closing entries:** Remove or move to “Done” only when the codebase or tests actually reflect the fix (not when docs alone change).

Last updated **2026-04-08** — **`@agent-runtime/adapters-openai`:** **`finish_reason`** mapping, embedding **`fetchTimeoutMs`** / **`signal`**, and response-derived **`dimensions`** (see **§3**); **§10** open-source checklist (LICENSE, CONTRIBUTING, SECURITY, CoC, releases). Repository roadmap: [`plan.md` — Progress snapshot](./plan.md).
