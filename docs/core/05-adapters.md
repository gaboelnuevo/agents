# Adapters: engine contracts

Related: [02-architecture.md](./02-architecture.md), [03-execution-model.md](./03-execution-model.md), [19-cluster-deployment.md](./19-cluster-deployment.md) (**`AgentRuntime`**, shared Redis / RunStore).

The engine core depends on **interfaces**, not specific databases. Two essential families in the loop: **memory** and **tools**. **Run** persistence uses **RunStore** (below), passed into **`AgentRuntime`**.

## Memory adapter

Abstracts read/write by memory type. The engine (or dedicated tools) invokes it.

```typescript
interface MemoryAdapter {
  save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void>;
  query(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<unknown[]>;
  delete(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<void>;
  getState(scope: MemoryScope): Promise<unknown>;
}

interface MemoryScope {
  projectId: string;
  agentId: string;
  sessionId: string;
  endUserId?: string;
}
```

The adapter uses `MemoryScope` to build storage keys. When `endUserId` is present, `longTerm` and `vectorMemory` are keyed by it instead of `sessionId`, enabling persistence across conversations for the same end-user. See [15-multi-tenancy.md §4.3](./15-multi-tenancy.md) for the full end-user memory model.

**`RedisMemoryAdapter` / `UpstashRedisMemoryAdapter`:** each `(keyPrefix):(memoryType)` is stored as a Redis **LIST**; **`save`** uses **`RPUSH`** so concurrent workers do not drop each other’s appends. Older deployments that used a **STRING** value (JSON array) are migrated to LIST on the first write after upgrade ([`technical-debt-security-production.md` §2](../planning/technical-debt-security-production.md#2-multi-worker-concurrency-and-integrity)).

### Key patterns

```text
{projectId}:{agentId}:{sessionId}:shortTerm:…          → recent turns (this conversation)
{projectId}:{agentId}:{sessionId}:working:…             → session/run variables

{projectId}:{agentId}:eu:{endUserId}:longTerm:…         → persistent facts (cross-session)
{projectId}:{agentId}:eu:{endUserId}:vectorMemory:…     → semantic embeddings (cross-session)
```

When no `endUserId` is present (internal / operator use), `longTerm` falls back to `sessionId`-scoped keys:

```text
{projectId}:{agentId}:{sessionId}:longTerm:…
```

### Logical types (not all required in v1)

| Type | Scoped by | Use in the engine |
|------|-----------|-------------------|
| `shortTerm` | `sessionId` | Recent turns injected into context. |
| `working` | `sessionId` | Session/run variables (priority, flags). |
| `longTerm` | `endUserId` (or `sessionId` fallback) | Persistence across runs and conversations. |
| `vectorMemory` | `endUserId` (or `sessionId` fallback) | Semantic retrieval (optional). |

The **Context Builder** decides which branches to read and in what order to build the prompt.

## Tool adapter

The **ToolRunner** resolves `action.tool` → executing instance.

```typescript
interface ToolAdapter {
  name: string;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
  validate?(input: unknown): boolean;
}

interface ToolContext {
  projectId: string;
  agentId: string;
  runId: string;
  sessionId: string;
  endUserId?: string;
  memoryAdapter: MemoryAdapter;
  securityContext: SecurityContext;
}
```

- **context**: includes scope identifiers, memory adapter reference, scoped credentials, and SecurityContext. Tools that interact with end-user data can use `endUserId` to scope external API calls.
- Output is normalized to an **observation** in history.

### Typical MVP engine tools

| Tool | Role |
|------|------|
| `system_save_memory` / `system_get_memory` | Bridge to MemoryAdapter. |
| `update_state` | Bounded working memory. |

Others (`http_request`, messages to other agents) are extensions: the **loop** stays the same.

### JSON-configured HTTP tools

**`@opencoreagents/adapters-http-tool`** registers **`ToolAdapter`** instances from **serializable** HTTP config (URL, method, headers, query/body templates) so integrations do not require a per-tool `execute` function in TypeScript. Templates can inject **`input`**, **`ToolContext`** fields, and **`secrets`** resolved at bootstrap. Host allowlisting defaults to the URL’s hostname unless an explicit **`allowedHosts`** list is set. See [20-http-tool-adapter.md](./20-http-tool-adapter.md).

**`@opencoreagents/dynamic-definitions`** combines a pluggable **definition store** with **upsert/sync** into the same registry (`Tool.define` / `Skill.define` / `Agent.define` + HTTP tool handlers). Use it when definitions arrive over **REST** or another API. See [21-dynamic-runtime-rest.md](./21-dynamic-runtime-rest.md).

## RunStore

Persists **`Run`** snapshots so a **`waiting`** run can be **resumed** later — including on **another worker** after a queue handoff or load-balanced HTTP request. Not a substitute for **MemoryAdapter** (different contract).

- **Wiring**: pass **`runStore`** (and other adapters) into **`new AgentRuntime({ … })`** once per worker ([19-cluster-deployment.md §2–§3](./19-cluster-deployment.md)).
- **Implementations**: **`InMemoryRunStore`** (tests / single process), **`RedisRunStore`** (`@opencoreagents/adapters-redis`), **`UpstashRunStore`** (`@opencoreagents/adapters-upstash`).
- **Consumers** using **`executeRun`** directly must **`runStore.save`** after each invocation when **`runStore`** is enabled (including **`waiting`** exits) — same persistence rules as **`RunBuilder`** / **`Agent.resume`**.

## Hooks vs adapters

- **Hooks**: observe the run (`onAction`, …); they must not be the only path for business execution.
- **Adapters**: the **authorized** path for side effects from a valid `action`.

## Multi-agent (engine note)

A **MessageBus** does not replace ToolRunner: it is usually **another tool** (`system_send_message`) or a service injected in `context`. The engine remains one loop per agent; coordination is policy on top of the same `action` / `wait` / `resume` model. Detail: [09-communication-multiagent.md](./09-communication-multiagent.md).

## Job queue adapter (primary: BullMQ)

This is **not** a third core contract inside the loop (unlike `MemoryAdapter` / `ToolAdapter`). It is **pluggable infrastructure** used by **consumers**: workers dequeue jobs and call the same entry points as the SDK or REST — `run` / `resume` with `RunInput` / `ResumeInput`. The engine core does not import BullMQ.

**Implementation priority:** **BullMQ on Redis** is the **first-class** path for async work and for waking runs after `wait` with `reason: scheduled` (delayed jobs, retries, DLQ, horizontal workers). Use **`@opencoreagents/adapters-bullmq`** for typed **`createEngineQueue`** and **`createEngineWorker`**. **`dispatchEngineJob(runtime, payload)`** and **`EngineJobPayload`** are implemented in **`@opencoreagents/core`** ([`dispatchJob.ts`](../../packages/core/src/engine/dispatchJob.ts), [`engineJobPayload.ts`](../../packages/core/src/engine/engineJobPayload.ts)); **`@opencoreagents/adapters-bullmq`** **re-exports** them so worker code can import queue + dispatch from one package. QStash stays a **secondary** HTTP-only alternative when you do not run Redis workers.

| Use | Role |
|-----|------|
| **Background runs** | API or webhook enqueues work; worker invokes the engine — avoids HTTP timeouts, adds retries and DLQ. |
| **Scheduled `wait`** | Delayed or repeatable jobs call `resume(runId, …)` when `reason: scheduled`. |
| **MessageBus backend** | Optional: one queue (or set of queues) per agent / `projectId` for `system_send_message` delivery with ordering and retries — still exposed to the engine as the same bus contract ([09-communication-multiagent.md](./09-communication-multiagent.md)). |

**Redis:** BullMQ expects a Redis deployment that supports its commands and connection model. If you already use Redis for `MemoryAdapter`, you can use the **same cluster** or a **dedicated** Redis for queues; validate provider compatibility (some serverless Redis products differ — test before committing). Full cluster deployment model: [19-cluster-deployment.md](./19-cluster-deployment.md).

### Alternative: Upstash QStash

When you **do not** want Redis-backed workers (e.g. purely serverless HTTP callbacks), **QStash** can trigger `POST /runs/:id/resume` (or equivalent) after a delay — same semantics as a BullMQ delayed job from the engine's perspective, different operational model. Use QStash as the **secondary** option when BullMQ is not a fit.

---

## Native TCP Redis (`@opencoreagents/adapters-redis`) — default for shared state

**Prefer this package** when you have a normal **`redis://`** / **`REDIS_URL`** (Docker, k8s, VM, or a vendor’s TCP endpoint). **`RedisMemoryAdapter`**, **`RedisRunStore`**, and **`RedisMessageBus`** use **`ioredis`** and match the **same key and stream layout** as the Upstash HTTP adapters, so you can swap transports without changing engine code. This is the **same connection style as BullMQ** — one Redis cluster can back queues and engine state.

**Vector** search is not in this package; use **`UpstashVectorAdapter`** from `@opencoreagents/adapters-upstash` for hosted vectors, or plug in another `VectorAdapter` implementation. See [19-cluster-deployment.md §7.1](./19-cluster-deployment.md#71-tcp-redis-vs-upstash-rest-vs-bullmq).

**Dynamic definitions:** **`RedisDynamicDefinitionsStore`** implements the **`DynamicDefinitionsStore`** facade from **`@opencoreagents/dynamic-definitions`** (**`store.methods`** for Redis I/O, **`store.Agent`** / **`Skill`** / **`HttpTool`** for CRUD); workers typically hydrate per job ([21-dynamic-runtime-rest.md](./21-dynamic-runtime-rest.md)).

---

## Upstash REST (`@opencoreagents/adapters-upstash`) — HTTP Redis + vector

Use **`@opencoreagents/adapters-upstash`** when you want **Upstash’s REST API** (serverless/edge-friendly, no long-lived TCP to Redis) or when you adopt **`UpstashVectorAdapter`** alongside **`UpstashRedisMemoryAdapter`** / **`UpstashRunStore`** / **`UpstashRedisMessageBus`** in one place. Same `MemoryAdapter` / `RunStore` / `MessageBus` contracts as above; scope in [06-mvp.md](./06-mvp.md#upstash-adapters-in-mvp). **Async / scheduled `resume`:** implement **BullMQ** first (above); **QStash** remains the documented **alternative** for HTTP-triggered wakeups without a worker process.
