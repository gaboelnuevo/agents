# Dynamic definitions: one runtime, REST-configured agents

Related: [20-http-tool-adapter.md](./20-http-tool-adapter.md) (JSON HTTP tools), [07-definition-syntax.md](./07-definition-syntax.md) (`Tool.define` / `Skill.define` / `Agent.define`), [19-cluster-deployment.md](./19-cluster-deployment.md) (per-process registry, worker bootstrap), [14-consumers.md](./14-consumers.md) (REST as consumer), [05-adapters.md](./05-adapters.md) (BullMQ, Redis adapters), [`plan-rest.md`](../plan-rest.md).

This document describes the **library-supported** pattern for **fully dynamic** agent configuration: definitions live in a **durable store** (typically **Redis** via **`RedisDynamicDefinitionsStore`**), **runs are executed by queue workers** (e.g. **BullMQ** on the same Redis), and each worker holds **`AgentRuntime`** plus **per-job hydration** — no TypeScript per tenant integration.

**Operational rule:** edits to **prompts**, **HTTP tools**, or **skills** in Redis do **not** require **redeploying workers** for the next job to see new data. Each job path should **read from the store when processing that agent** (via **`hydrateAgentDefinitionsFromStore`** before **`Agent.load`**, or by setting **`dynamicDefinitionsStore`** on **`AgentRuntime`** so **`dispatch`** / **`dispatchEngineJob`** hydrate automatically); the in-process registry is a materialization for that run, not a stale deploy-time snapshot.

### Target architecture (Redis + BullMQ)

| Layer | Role |
|--------|------|
| **Redis (definitions)** | Source of truth for agents, skills, HTTP tool JSON (`RedisDynamicDefinitionsStore`). |
| **BullMQ** | **`run` / `resume`** jobs; **one worker** processes a given job at a time; payload includes **`projectId`**, **`agentId`**, session/run ids, user input. See [05-adapters.md § Job queue](./05-adapters.md#job-queue-adapter-primary-bullmq). |
| **API / BFF** | Validates auth, writes definitions to Redis, **enqueues** work — usually does **not** run the full engine loop inline (avoids HTTP timeouts). |
| **Worker process** | **`AgentRuntime`** + shared **`MemoryAdapter` / `RunStore`** on Redis if needed; **on each job**, before running that agent: **read definitions from the store** (**`hydrateAgentDefinitionsFromStore`**, or **`runtime.dispatch`** when **`dynamicDefinitionsStore`** is set on the runtime) → **`Agent.load`** → **`run` / `resume`** — so Redis edits apply without worker redeploy ([§2.2](#22-updates-without-redeploying-workers)). |

---

## 1. What is dynamic vs what stays in code

| Dynamic (data / JSON) | Stays in code (deploy) |
|------------------------|-------------------------|
| **`AgentDefinitionPersisted`** — prompts, `tools` / `skills` lists, `llm` metadata | **`AgentRuntime`** wiring: **`LLMAdapter`**, **`MemoryAdapter`**, **`RunStore`**, optional vector / bus / RAG registration |
| **`SkillDefinitionPersisted`** — description, `tools[]` (no imperative **`execute`** from REST) | Skills that need **`SkillExecute`** logic in TypeScript |
| **`HttpToolConfig`** — outbound HTTP tool behavior | Built-in engine tools (**`system_*`**) from **`AgentRuntime`** and **`@opencoreagents/rag`** |

**Tools with arbitrary side effects** that are not HTTP-shaped still need a **`ToolAdapter`** in the deployed bundle (or a generic HTTP config as above).

---

## 2. Package: `@opencoreagents/dynamic-definitions`

**Core integration:** **`dispatchEngineJob`** / **`AgentRuntime.dispatch`** live in **`@opencoreagents/core`**. When **`AgentRuntime`** is constructed with **`dynamicDefinitionsStore`**, core **dynamically imports** **`@opencoreagents/dynamic-definitions`** at runtime and calls **`hydrateAgentDefinitionsFromStore`** before **`Agent.load`** (unwraps **`store.methods`** when you pass a **`DynamicDefinitionsStore`** facade). **`core`** does **not** list **`dynamic-definitions`** as a build-time dependency (avoids package cycles); workers that use the store must still **install** **`@opencoreagents/dynamic-definitions`** so the import resolves.

- **`DynamicDefinitionsStore`** — facade: **`store.methods`** (**`DynamicDefinitionsStoreMethods`**: `save*` / `list*` / `getSnapshot`) plus **`store.Agent` / `store.Skill` / `store.HttpTool` / `store.syncProject`**. **`InMemoryDynamicDefinitionsStore`** (demo) and **`RedisDynamicDefinitionsStore`** (**`@opencoreagents/adapters-redis`**) implement it — **Redis as source of truth** (HASH per project: `{prefix}:{projectId}:httpTools|skills|agents`, field = id, value = JSON). **Admin / control plane** can use **`store.Agent.define`** etc.; **run workers** read via **`store.methods`** (or pass the facade to **`dynamicDefinitionsStore`**) **when they execute a job** (see §2.1).
- **`hydrateAgentDefinitionsFromStore(storeOrMethods, projectId, agentId, { secrets })`** — **recommended for job workers**: first argument is a **`DynamicDefinitionsStore`** facade **or** a bare **`DynamicDefinitionsStoreMethods`** (e.g. **`store.methods`**); the package resolves persistence before reading. Loads **only** that agent, its **skills**, and **HTTP tools** referenced by the agent or those skills; registers them in the **current** process. No full-project **sync** at boot. **Throws** if any **`agent.skills`** id is **missing** from the store (data error). Tool ids in the resolved allowlist that are **not** in the store are assumed to be **built-ins** (`system_*`, RAG tools, etc.) already registered by **`AgentRuntime`** / RAG — if a tool id is wrong, the run fails at **`action`** time.
- **`upsertHttpToolDynamic`**, **`upsertSkillDynamic`**, **`upsertAgentDynamic`** — write-through to the store **and** the local registry (typical for **ingest APIs**, not for stateless runners). Same **facade-or-methods** resolution as **`hydrateAgentDefinitionsFromStore`**.
- **`syncProjectDefinitionsToRegistry`** — optional **full-project** replay into the local registry (warm cache, dev, migrations). **Not required** if every worker uses **`hydrateAgentDefinitionsFromStore`** per job.
- **`bindDefinitions`**, **`createDynamicDefinitionsStore`**, **`resolveDefinitionsStoreMethods`** — **`bindDefinitions`** returns **`Agent` / `Skill` / `HttpTool` / `syncProject`** bound to a **`DynamicDefinitionsStoreMethods`** or unwraps a facade’s **`methods`**. **`createDynamicDefinitionsStore(methods)`** builds a facade from a custom backend. Typical apps use **`new RedisDynamicDefinitionsStore`** / **`new InMemoryDynamicDefinitionsStore`** and **do not** call **`bindDefinitions`** separately.

**Secrets** for **`{{secret:*}}`** in HTTP tool templates are passed at registration time (**`HttpToolSecretsOptions.secrets`**), not stored inside public JSON.

### 2.1 Stateless workers (no boot sync)

Run nodes only need **`AgentRuntime`** + a **`Redis`** (or other) client. When a job payload carries **`projectId`** and **`agentId`**, either pass the **facade** (e.g. **`RedisDynamicDefinitionsStore`**) as **`dynamicDefinitionsStore`** (and optional **`dynamicDefinitionsSecrets`**) into **`AgentRuntime`** and use **`runtime.dispatch`** / **`dispatchEngineJob`** — core uses **`store.methods`** for **`hydrateAgentDefinitionsFromStore`** — or call **`await hydrateAgentDefinitionsFromStore(storeOrMethods, projectId, agentId, { secrets })`** yourself then **`Agent.load(agentId, runtime, { session })`** + **`run`**. The **store** is authoritative; the in-process registry is a **throwaway materialization** for that process (re-hydrating the same agent on the next job is idempotent for **`Map.set`** semantics).

**Hot writes to Redis** from an admin API do **not** require every worker to sync: the next job for that agent loads fresh rows from Redis via **`hydrateAgentDefinitionsFromStore`**.

### 2.2 Updates without redeploying workers

With **per-job hydration**, the worker **reads** dynamic definitions from the store **each time** it processes a job for that agent (**`hydrateAgentDefinitionsFromStore`** immediately before **`Agent.load`** is the supported way to do that). With that pattern, changing **prompts**, **skills**, or **HTTP tool** JSON in Redis is visible on the **next** job **without** redeploying workers: hydration re-reads from Redis and **`Agent.define` / `registerHttpToolsFromDefinitions`** overwrite registry entries (**`Map.set`**) for the same ids.

**Caveats:**

- **Runs already in progress** keep whatever was hydrated when **that** job started; mid-run updates in Redis do not apply retroactively.
- **Jobs already queued** see Redis as it is **when the worker runs `hydrate`** for that attempt, not when the job was enqueued (usually what you want).
- **Orphan handlers:** tool ids no longer referenced by an agent may still exist in the process-global handler map until overwritten or the process restarts; they do **not** affect agents that do not allowlist those tools.
- If a worker **skips** hydration and relies on an old in-memory catalog, redeploy or a full **`syncProjectDefinitionsToRegistry`** would be required — avoid that path for fully dynamic operation.

### 2.3 Store read failures and the job queue

If **`hydrateAgentDefinitionsFromStore`** throws (Redis unreachable, timeout, **agent missing** in the store, corrupt JSON, etc.), the worker should **fail the job** and **not** treat the run as successful. Another node may take the **retry**; that is normal queue semantics:

- **Transient errors** (network, Redis blip): configure **retries with backoff** on the queue (e.g. BullMQ `attempts` / `backoff`). Another worker may process the **next** attempt after the job is **not** acknowledged or is re-queued.
- **Permanent errors** (unknown `agentId`, row deleted): after **N failures**, move the job to a **DLQ** or dead-letter so ops can fix data or notify the tenant.
- **At-least-once** delivery means a run may execute more than once if a worker crashes **after** side effects but **before** ack — design **HTTP tools** and downstream APIs with **idempotency keys** where it matters.
- Optionally wrap **`hydrateAgentDefinitionsFromStore`** in a **short local retry** (few tries, small delay) before surfacing failure to the queue, to absorb brief Redis hiccups without consuming full job attempts.

The library does not hide store failures: **no hydrate → no `Agent.load`** — fail fast and let the queue policy decide retries vs DLQ.

---

## 3. Multi-instance / cluster

The engine registry is **per Node process** ([`registry.ts` comment](./19-cluster-deployment.md)). For **queue workers**:

1. Build the same **`AgentRuntime`** (shared adapters: LLM, **Redis** `MemoryAdapter` / **`RunStore`**, etc.).
2. On **each job**: either set **`dynamicDefinitionsStore`** (facade or bare **`DynamicDefinitionsStoreMethods`**) on the runtime and **`runtime.dispatch`**, or call **`hydrateAgentDefinitionsFromStore`** with **`RedisDynamicDefinitionsStore`** / **`store.methods`** / your backend, then **`Agent.load`** + **`run` / `resume`**.

**Optional:** **`syncProjectDefinitionsToRegistry`** at boot if you want a warm local catalog for non-dynamic tools or debugging — not required for correctness when using per-job hydration.

There is **no cross-process sync** inside `@opencoreagents/core`; **Redis (or DB)** is the shared source of truth for dynamic rows.

**Tool id collisions:** **`toolHandlers`** are keyed by tool **name** globally. Prefer **tenant-prefixed** tool ids (e.g. `acme__crm_lookup`) if multiple projects share one process.

### 3.1 Project isolation vs `scope: "global"`

Definitions loaded through **`@opencoreagents/dynamic-definitions`** (store, REST, sync) are **always project-scoped**. The package **strips** any `scope` field from tools/skills and **rejects** `scope: "global"`.

**`scope: "global"`** in the engine is reserved for:

- **Built-ins** registered by **`AgentRuntime`** / **`@opencoreagents/rag`** (`system_*`, vector tools, etc.).
- **Your code** calling **`Tool.define` / `Skill.define`** with `scope: "global"` when you intentionally share a definition across all projects.

Nothing in the dynamic store should mark itself global — that would break tenant isolation expectations. See also [15-multi-tenancy.md](./15-multi-tenancy.md).

---

## 4. Reference example

**[`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/)** — **Redis** **`RedisDynamicDefinitionsStore`**; Express **CRUD** uses **`store.HttpTool.define`**, **`store.Skill.define`**, **`store.Agent.define`**, and **`store.methods.getSnapshot`** (no separate **`bindDefinitions`**). **`POST /v1/run`** **enqueues** BullMQ jobs; **worker** constructs **`AgentRuntime`** with **`dynamicDefinitionsStore`** / **`dynamicDefinitionsSecrets`** and **`runtime.dispatch(job.data)`** (same as **`dispatchEngineJob`**; core hydrates via **`store.methods`** before **`Agent.load`**). Default response **202** + **`jobId`** — poll **`GET /v1/jobs/:id`**. **`?wait=1`** or JSON **`"wait": true`** blocks until the job completes (BullMQ **`waitUntilFinished`**; timeout → **504**, other wait failures → **502** — see example README). Requires **Redis** and two processes (API + worker). Not product-hardened (no auth, no rate limits, no schema validation on PUT bodies).

Routes:

- **`PUT /v1/http-tools/:toolId`** — **`HttpToolConfig`** (optional **`_secrets`** only affects the API process registry; the worker resolves **`{{secret:*}}`** from **`HTTP_TOOL_SECRETS_JSON`** — see that README).
- **`PUT /v1/skills/:skillId`** — **`SkillDefinitionPersisted`**.
- **`PUT /v1/agents/:agentId`** — **`AgentDefinitionPersisted`**.
- **`GET /v1/definitions`** — Redis snapshot for the configured **`PROJECT_ID`**.

For **unit tests** without Redis, use **`InMemoryDynamicDefinitionsStore`** from **`@opencoreagents/dynamic-definitions`** (see package tests). Optional **`syncProjectDefinitionsToRegistry`** or **`store.syncProject(projectId)`** at worker boot is documented in §2; the example relies on **per-job hydration** via **`dynamicDefinitionsStore`** on the runtime (equivalent to **`Agent.prepare`** / **`hydrateAgentDefinitionsFromStore`** before load).

See [08-scope-and-security.md](./08-scope-and-security.md) for hardening.

---

## 5. REST surface vs `plan-rest.md`

[`plan-rest.md`](../plan-rest.md) lists a **full product** vision (memory routes, inter-agent HTTP, …). **`@opencoreagents/rest-api`** implements the **run / resume / runs / jobs** subset on Express — see *Implemented today* in that doc. **`dynamic-definitions`** focuses on **definition CRUD** (**`store.Agent.define`** / **`store.Skill.define`** / **`store.HttpTool.define`** on the **`DynamicDefinitionsStore`** facade, with **`projectId` on each payload**) and **per-job hydration** (**`Agent.prepare`**, **`hydrateAgentDefinitionsFromStore`**, or **`AgentRuntime`** **`dynamicDefinitionsStore`**) (or optional full **`sync`**) so your BFF can match the plan while reusing the same engine primitives.

---

## 6. Summary

- **Goal:** **fully dynamic** configuration — agents, skills, and HTTP tools as JSON in **Redis**; worker code only wires **`AgentRuntime`** (LLM, memory, `RunStore`, RAG / built-ins).
- **Execution:** the **BFF or API** enqueues a job on **BullMQ** (same Redis or another broker, depending on ops); a **worker** picks up the job, hydrates from the store (**`dynamicDefinitionsStore`** on **`AgentRuntime`** + **`dispatch`** — core uses **`store.methods`** when the value is a facade — or manual **`store.Agent.prepare`** / **`hydrateAgentDefinitionsFromStore`**), then **`Agent.load`** and **`run` / `resume`**.
- **Source of truth:** Redis (hashes per `projectId`), not the process heap. The worker **reads from the store when processing that agent** (per-job hydration); without that step, there is no guarantee updates appear without redeploying workers.
- **Facade:** **`DynamicDefinitionsStore`** = **`store.methods`** (**`DynamicDefinitionsStoreMethods`**) + **`store.Agent` / `store.Skill` / `store.HttpTool` / `store.syncProject`** — no separate **`bindDefinitions`** call for **`RedisDynamicDefinitionsStore`** / **`InMemoryDynamicDefinitionsStore`**.
- **Redis changes (prompts, HTTP tools, skills):** **no** **worker redeploy** required; the **next** job that hydrates that agent sees the new data. **Runs already in flight** are not updated mid-execution.
- **Redis read failures:** fail the job; retries, another node, or DLQ per queue policy ([§2.3](#23-store-read-failures-and-the-job-queue)).
- **Agent references a skill id missing from Redis:** **`hydrateAgentDefinitionsFromStore`** **throws** (fail fast); fix data or DLQ after retries.
- **`scope: "global"`** only for built-ins or for **`Tool.define` / `Skill.define`** in your code; the dynamic store is **always per project** ([§3.1](#31-project-isolation-vs-scope-global)).
