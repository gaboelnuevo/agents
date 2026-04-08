# Cluster deployment: multi-process and horizontal scaling

How the agent runtime behaves when multiple processes (workers, replicas, containers) run in parallel. What is per-process, what must be shared, and what changes in each layer.

Related: [05-adapters.md](./05-adapters.md) (adapters + BullMQ), [09-communication-multiagent.md](./09-communication-multiagent.md) (MessageBus), [15-multi-tenancy.md](./15-multi-tenancy.md) (tenant isolation).

---

## Status (this repository)

| Area | Implemented | Planned / design only |
|------|-------------|------------------------|
| **RunStore** | `RunStore` in `@agent-runtime/core`; `InMemoryRunStore`; **`RedisRunStore`** (`@agent-runtime/adapters-redis`); `UpstashRunStore` (`@agent-runtime/adapters-upstash`); `configureRuntime({ runStore })`; `RunBuilder` persists after each run; `Agent.resume(runId, input)` | DB-backed `RunStore`, TTL/cleanup policies |
| **Job queue** | **`@agent-runtime/adapters-bullmq`** — `createEngineQueue`, `createEngineWorker`, `dispatchEngineJob` (BullMQ **priority**) | QStash HTTP handler **not** in monorepo; delayed `resume` orchestration still app-specific |
| **MessageBus** | `InProcessMessageBus`, **`RedisMessageBus`** (`@agent-runtime/adapters-redis`), `UpstashRedisMessageBus` | BullMQ-as-transport for messages (alternative pattern) |
| **Bootstrap** | `configureRuntime()` registers built-in tools (`save_memory`, `get_memory`) and optional vector / `send_message` handlers | — |
| **Direct engine API** | `buildEngineDeps`, `createRun`, `executeRun`, `getAgentDefinition` — same loop as `RunBuilder`; use when a job handler should not use `Agent.run` | You must call `runStore.save` after each `executeRun` when using `runStore` (including `waiting`) |

---

## 1. Architecture: per-process vs shared

```
┌──────────────────────────────────────────────────────────────────┐
│  Shared infrastructure (Redis / Upstash / Postgres / etc.)       │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌───────────┐│
│  │MemoryStore │  │  RunStore  │  │  Job Queue  │  │ MessageBus││
│  │(Redis) ✓   │  │(Redis) ✓   │  │(BullMQ) ○   │  │(Redis) ✓  ││
│  └────────────┘  └────────────┘  └─────────────┘  └───────────┘│
└──────────────────────────────────────────────────────────────────┘
         ▲                ▲                ▲               ▲
         │                │                │               │
   ╔═══════════╗   ╔═══════════╗   ╔═══════════╗
   ║  Worker 1 ║   ║  Worker 2 ║   ║  Worker N ║
   ║───────────║   ║───────────║   ║───────────║
   ║ Registry  ║   ║ Registry  ║   ║ Registry  ║   ← identical bootstrap
   ║ Config    ║   ║ Config    ║   ║ Config    ║   ← configureRuntime()
   ║ Engine    ║   ║ Engine    ║   ║ Engine    ║   ← stateless per-run
   ║ Adapters  ║   ║ Adapters  ║   ║ Adapters  ║   ← point to shared infra
   ╚═══════════╝   ╚═══════════╝   ╚═══════════╝
```

Legend: **✓** = adapter(s) in repo. **○** = job queue layer not implemented here; integrate BullMQ/QStash in your app.

### 1.1 Per-process (replicated on every node)

| Component | Why per-process | Cluster requirement |
|-----------|----------------|---------------------|
| **Definition registry** (`registry.ts`) | Module-level `Map`s — tool, skill, and agent definitions | Every worker must execute the **same** `Tool.define` / `Skill.define` / `Agent.define` calls at startup. Definitions are code-level; they do **not** sync across processes at runtime. |
| **Runtime config** (`configureRuntime()`) | Singleton `let config` | Each worker calls `configureRuntime({ llmAdapter, memoryAdapter, ... })` at boot. Config is identical across nodes. |
| **Tool handlers** | Registered via `registerToolHandler` into a process-local `Map` | Each worker registers the same handler set. Handlers contain code (functions), not serializable. |
| **Engine loop** (`executeRun`) | Pure function: takes `Run` + `EngineDeps`, returns `Run` | Stateless — any worker can execute any run as long as it can read/write the `Run` from a shared store. |
| **Built-in tools** (`save_memory`, `get_memory`) | Registered by `configureRuntime` | Same on every node — they delegate to the shared `MemoryAdapter`. |

**Key rule**: definitions and handlers are **code deployed identically** to every node. There is no runtime "definition sync" protocol; if you add a new `Tool.define`, redeploy all workers.

### 1.2 Shared (external infrastructure)

| Component | Implementation | Cluster role |
|-----------|---------------|-------------|
| **MemoryAdapter** | **`RedisMemoryAdapter`** (TCP, `@agent-runtime/adapters-redis`), `UpstashRedisMemoryAdapter` (REST), Postgres | All workers read/write the same memory store. `InMemoryMemoryAdapter` is **single-process only** (tests / local dev). |
| **RunStore** | `InMemoryRunStore` (tests/local), **`RedisRunStore`** (TCP, `@agent-runtime/adapters-redis`), `UpstashRunStore` (HTTP, `@agent-runtime/adapters-upstash`) | Persists `Run` so `wait` on node A can be `resume`d on node B. Wired via `configureRuntime({ runStore })` — see §3. |
| **Job queue** (BullMQ / QStash) | *Design / planned* — not implemented in this monorepo | Distributes `run` / `resume` jobs across workers. You add a BullMQ worker or QStash endpoint that calls `Agent.load` + `agent.run` / `agent.resume`. |
| **MessageBus** | `InProcessMessageBus` (single process), **`RedisMessageBus`** (TCP Streams, `@agent-runtime/adapters-redis`), `UpstashRedisMessageBus` (REST) | Delivers `send_message` across workers with `configureRuntime({ messageBus })`. |
| **VectorAdapter** | Upstash Vector | Shared semantic index — stateless queries from any node. |

---

## 2. Bootstrap contract (per worker)

Every worker process must execute this sequence before handling jobs:

```typescript
import { configureRuntime, Agent, Tool, Skill } from "@agent-runtime/core";
import { OpenAILLMAdapter } from "@agent-runtime/adapters-openai";
import { RedisMemoryAdapter, RedisRunStore, RedisMessageBus } from "@agent-runtime/adapters-redis";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

// 1. Adapters pointing to shared infrastructure (built-in tools register inside configureRuntime).
// Prefer TCP Redis (`adapters-redis`) for the same connection style as BullMQ and typical production clusters.
configureRuntime({
  llmAdapter: new OpenAILLMAdapter(process.env.OPENAI_API_KEY!),
  memoryAdapter: new RedisMemoryAdapter(redis),
  runStore: new RedisRunStore(redis), // required for wait/resume across workers
  messageBus: new RedisMessageBus(redis), // omit if you do not use send_message across processes
});

// Alternative — Upstash REST (no TCP): same contracts, HTTP client to Redis
// import { UpstashRedisMemoryAdapter, UpstashRunStore, UpstashRedisMessageBus } from "@agent-runtime/adapters-upstash";
// const redisUrl = process.env.UPSTASH_REDIS_URL!;
// const redisToken = process.env.UPSTASH_REDIS_TOKEN!;
// configureRuntime({
//   llmAdapter: new OpenAILLMAdapter(process.env.OPENAI_API_KEY!),
//   memoryAdapter: new UpstashRedisMemoryAdapter(redisUrl, redisToken),
//   runStore: new UpstashRunStore(redisUrl, redisToken),
//   // messageBus: new UpstashRedisMessageBus(redisUrl, redisToken),
// });

// 2. Definitions — identical on every node (your domain tools/skills/agents only).
// Do NOT re-define built-ins: save_memory / get_memory are registered by configureRuntime.
await Tool.define({
  id: "lookup_ticket",
  scope: "global",
  description: "Example custom tool",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  execute: async (input) => ({ ok: true }),
});
await Skill.define({ id: "intakeSummary", /* ... */ });
await Agent.define({ id: "ops-analyst", /* ... */ });

// 3. Start consuming jobs (your BullMQ worker, HTTP server, etc.) — see §4
```

If step 2 differs between workers, behavior is undefined: one node may refuse a tool another node allows.

---

## 3. RunStore

The engine keeps a `Run` in memory during `executeRun`. For clusters, **`RunBuilder` saves the run after each `executeRun` when `runStore` is set**, including when status is `waiting`, so another worker can call `Agent.resume`.

### 3.1 Interface (implemented in `@agent-runtime/core`)

```typescript
interface RunStore {
  save(run: Run): Promise<void>;
  load(runId: string): Promise<Run | null>;
  delete(runId: string): Promise<void>;
  listByAgent(agentId: string, status?: RunStatus): Promise<Run[]>;
}
```

### 3.2 Implementations

| Impl | When |
|------|------|
| `InMemoryRunStore` | Tests, local dev, single-process |
| `UpstashRunStore` (`@agent-runtime/adapters-upstash`) | Production cluster — JSON per `run` in `run:data:{runId}` plus `run:agent:{agentId}` SET for listing |
| DB-backed | High-volume production with audit requirements (implement `RunStore` yourself) |

### 3.3 Integration points

- `Agent.run()` / `Agent.resume()` → `RunBuilder` calls `runStore.save(run)` after every `executeRun` when `runStore` is configured (including `status: waiting` so another worker can resume).
- **`buildEngineDeps` + `createRun` + `executeRun`** (no `RunBuilder`) → you must **`runStore.save(run)`** after each `executeRun` when `runStore` is set, same as `RunBuilder` (including `waiting`).
- `Agent.resume(runId, input)` → `runStore.load(runId)` (must be `waiting`), injects a user `resumeMessages` turn, then `executeRun` continues the loop.
- On `completed` / `failed` → same save applies; optionally delete or archive in your app if you do not want long-term retention.

Pass the adapter via `configureRuntime({ ..., runStore })` alongside `memoryAdapter` and `llmAdapter`.

---

## 4. Job queue: cluster execution model (**BullMQ priority**)

The job queue is **not** inside `packages/core` — it is **infrastructure** that invokes the engine. **`@agent-runtime/adapters-bullmq`** provides typed **queue** / **worker** helpers and **`dispatchEngineJob`** so workers call the same **`Agent.run`** / **`Agent.resume`** path as the SDK. QStash is **not** packaged here; integrate HTTP callbacks in your app if needed.

```
┌────────────┐     ┌──────────────┐     ┌────────────┐
│ API / Webhook │──►│  Job Queue   │──►│  Worker    │
│ enqueues job  │   │  (BullMQ)    │   │  (engine)  │
└────────────┘     └──────────────┘     └────────────┘
```

### 4.1 BullMQ (primary) — `adapters-bullmq`

- **Package**: `createEngineQueue`, `createEngineWorker`, `dispatchEngineJob`, `DEFAULT_ENGINE_QUEUE_NAME`, typed **`EngineJobPayload`** (`kind: "run" | "resume"`).
- **Design**: one or more workers per queue, all running the same bootstrap (§2).
- Worker **processor** typically **`await dispatchEngineJob(job.data)`** after `configureRuntime` + definitions — or (low-level) `getAgentDefinition` + `buildEngineDeps` + `createRun` / `executeRun` with `runStore.save` as in §3.3.
- Retries, backoff, dead-letter are BullMQ config — the engine sees a normal run.
- `wait` → worker completes the job (run is persisted in `RunStore`). A **delayed `addResume`** or **separate scheduled job** later processes `resume`.
- **Horizontal scaling**: add worker processes; BullMQ + Redis coordinate (see §7).

Minimal worker (same bootstrap as §2 — `configureRuntime` + definitions before `Worker` starts):

```typescript
import {
  DEFAULT_ENGINE_QUEUE_NAME,
  createEngineWorker,
  dispatchEngineJob,
} from "@agent-runtime/adapters-bullmq";
import type { Job } from "bullmq";

// connection: BullMQ `ConnectionOptions` — often `{ url: process.env.REDIS_URL }` for TCP Redis
const connection = { url: process.env.REDIS_URL! };

createEngineWorker(
  DEFAULT_ENGINE_QUEUE_NAME,
  connection,
  async (job: Job) => {
    await dispatchEngineJob(job.data);
  },
);
```

Enqueue from your API with **`createEngineQueue`** (`addRun` / `addResume`) using the same `queueName` and `connection`.

### 4.2 QStash (alternative) — planned integration

- **Design**: serverless — QStash POSTs to an HTTP endpoint (e.g. `/runs/:id/resume`) after a delay.
- The HTTP handler loads the run from `RunStore`, calls `agent.resume`, and responds.

---

## 5. MessageBus in cluster

| Mode | Scope | Implementation |
|------|-------|----------------|
| **In-process** | Single-process dev / tests | `InProcessMessageBus` (`@agent-runtime/core`) |
| **Redis Streams (TCP)** | Cluster (multiple workers) | `RedisMessageBus` (`@agent-runtime/adapters-redis`) — stream `bus:agent:{toAgentId}`, `XRANGE` polling in `waitFor`. |
| **Redis Streams (REST)** | Cluster (multiple workers) | `UpstashRedisMessageBus` (`@agent-runtime/adapters-upstash`) — same keys/semantics over HTTP. |
| **BullMQ-backed** | *Optional app pattern* | For **`run`/`resume` jobs**, use **`@agent-runtime/adapters-bullmq`** (§4). Using BullMQ **as transport for `send_message`** (instead of Redis Streams) is a custom design — not a separate package. |

In cluster mode, `send_message` from agent A (on worker 1) writes to Redis; agent B’s run (on worker 3) picks it up via `waitFor` when using `UpstashRedisMessageBus` or `RedisMessageBus`.

---

## 6. What breaks if you ignore this

| Scenario | Single process | Cluster without shared stores |
|----------|---------------|-------------------------------|
| `Agent.define` on deploy | Works | Each worker has its own copy — fine if all deploy the same code |
| `agent.run("hello")` | Works | Works — stateless execution |
| `wait` → `resume` | Works with in-memory `Run` if same process | **Breaks** without `RunStore` — `Run` lost when another worker must resume. |
| `save_memory` → `get_memory` | Works with `InMemoryMemoryAdapter` | **Breaks** — data in worker 1's heap. Needs shared Redis. |
| `send_message` (multi-agent) | Works with in-process bus | **Breaks** — in-process bus is per-process. Needs `UpstashRedisMessageBus`, `RedisMessageBus`, or equivalent shared bus. |
| Job retry after crash | No mechanism in engine | **You add** BullMQ (or equivalent) around `agent.run` / `agent.resume`. |

---

## 7. Recommended production stack

```
┌─────────────────────────────┐
│  Upstash Redis (REST)       │
│  *or* TCP Redis (adapters-  │
│  redis: memory/run/bus)     │
│  ├── MemoryAdapter          │
│  ├── RunStore               │
│  └── MessageBus (streams)    │
│                             │
│  Same Redis *or* separate   │
│  TCP Redis for BullMQ ○     │  ← your infrastructure (not in monorepo)
│                             │
│  Upstash Vector             │
│  └── VectorAdapter          │
├─────────────────────────────┤
│  N × Worker process         │
│  (identical code, same env) │
│  configureRuntime(…)        │
│  Tool/Skill/Agent.define(…) │
│  Your BullMQ Worker.on ○    │
└─────────────────────────────┘
```

Workers are stateless and horizontally scalable for **engine** execution. Add or remove workers without changing definitions.

### 7.1 TCP Redis vs Upstash REST vs BullMQ

| Use case | Typical connection | Notes |
|----------|-------------------|--------|
| **TCP Redis adapters** (`RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus` in `@agent-runtime/adapters-redis`) | **TCP** (`ioredis`) | **Default for clusters:** same semantics as REST adapters; one `REDIS_URL` can back engine state **and** BullMQ workers. |
| **Upstash REST adapters** (`UpstashRedisMemoryAdapter`, `UpstashRunStore`, `UpstashRedisMessageBus`) | Upstash **REST** (`fetch` JSON command arrays) | No persistent TCP connection; good for serverless/edge; `MessageBus.waitFor` uses polling over HTTP. |
| **BullMQ** | **TCP** Redis (`ioredis` / `node-redis`) | Requires long-lived connection — **not** the REST-only Upstash client. Often the **same** TCP Redis as `@agent-runtime/adapters-redis`. |
| **Practical split** | One or two connections | Prefer **one TCP Redis** for `adapters-redis` + BullMQ; add **Upstash REST** only if you need HTTP-only access; add **Upstash Vector** for hosted vectors (can pair with either). |

You can run **Upstash Vector** with **Upstash Redis REST** for engine state and a **separate** TCP Redis for BullMQ — or consolidate on **TCP** for queues + `adapters-redis` and keep **only** `UpstashVectorAdapter` from `@agent-runtime/adapters-upstash`.

---

## 8. Graceful shutdown (workers)

When stopping a worker process (deploy, scale-down, SIGTERM):

1. **Stop accepting new jobs** — drain your HTTP server or pause BullMQ worker consumption (`worker.close()` in BullMQ) so no new `agent.run` starts.
2. **Wait for in-flight runs** — `executeRun` may still be running; use a shutdown timeout (e.g. 30–120s) and `AbortSignal` if you wire it through `RunBuilder` / engine in the future.
3. **Persist state** — with `runStore`, waiting runs are already saved after each step; completing workers should not lose `Run` state.
4. **Exit** — `process.exit(0)` after the drain timeout.

The engine does not ship a global run registry; **your** queue layer should track active jobs and await completion before exit.

---

## 9. Minimal deploy recipe (Docker Compose)

Example: two identical worker containers sharing Redis (TCP) for BullMQ *when you add it*, plus Redis/Upstash-compatible endpoints for adapters. This is a **skeleton** — replace image names and env with your registry.

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  worker-a:
    build: .
    environment:
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      UPSTASH_REDIS_URL: ${UPSTASH_REDIS_URL}
      UPSTASH_REDIS_TOKEN: ${UPSTASH_REDIS_TOKEN}
    command: ["node", "dist/worker.js"]
    deploy:
      replicas: 2
```

- **Two replicas** of the same image run the same bootstrap (§2); both call `configureRuntime` with shared Upstash URLs for `memoryAdapter`, `runStore`, and optionally `messageBus`.
- **BullMQ** (when you add it) would use `REDIS_URL` against `redis:6379` for the queue only, while Upstash remains for REST-backed adapters if you keep that split (§7.1).
- For **local-only** experiments, point all adapters at `redis:6379` only if you implement TCP Redis variants — the shipped Upstash adapters expect the **Upstash REST** URL format.

---

## 10. Relationship to other docs

| Doc | Connection |
|-----|------------|
| [02-architecture.md](./02-architecture.md) | Component view — this doc adds the multi-process dimension. |
| [05-adapters.md](./05-adapters.md) | BullMQ / QStash as job queue; this doc explains cluster deployment and what is actually implemented. |
| [06-mvp.md](./06-mvp.md) | MVP scope: "distributed store for Agent.define" out of MVP — this doc explains why it's acceptable. |
| [09-communication-multiagent.md](./09-communication-multiagent.md) | MessageBus in-process vs Redis — this doc formalizes the cluster requirement. |
| [15-multi-tenancy.md](./15-multi-tenancy.md) | `projectId` isolation applies identically across cluster workers. |
| [`../scaffold.md`](../scaffold.md) | Implementation phases; RunStore / cluster support in the phase plan. |
