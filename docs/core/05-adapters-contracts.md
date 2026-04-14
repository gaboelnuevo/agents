# Adapters: memory, tools, and RunStore

Related: [02-architecture.md](./02-architecture.md), [03-execution-model.md](./03-execution-model.md), [19-cluster-deployment.md](./19-cluster-deployment.md) (**`AgentRuntime`**, shared Redis / RunStore).

The engine core depends on **interfaces**, not specific databases. Two essential families in the loop: **memory** and **tools**. **Run** persistence uses **RunStore** (below), passed into **`AgentRuntime`**.

For **job queues** (BullMQ, QStash) and **concrete Redis / Upstash packages**, see [06-adapters-infrastructure.md](./06-adapters-infrastructure.md).

## Shipped packages (what exists in this monorepo)

**`@opencoreagents/core`** owns the **interfaces** (`MemoryAdapter`, `ToolAdapter`, `RunStore`, `LLMAdapter`, …). Everything below is an **optional dependency** you add next to `core` when you need that backend. **Authoritative usage snippets** (constructors, env vars, exports) live in each **package README** linked here.

| Role | Package | Implements / provides | Core reference | Package README |
|------|---------|----------------------|----------------|----------------|
| **LLM** | `@opencoreagents/adapters-openai` | `OpenAILLMAdapter`, `OpenAIEmbeddingAdapter` | [10-llm-adapter.md](./10-llm-adapter.md) | [adapters-openai/README.md](../../packages/adapters-openai/README.md) |
| **LLM** | `@opencoreagents/adapters-anthropic` | `AnthropicLLMAdapter` | [10-llm-adapter.md](./10-llm-adapter.md) | [adapters-anthropic/README.md](../../packages/adapters-anthropic/README.md) |
| **Memory / RunStore / MessageBus** (TCP Redis) | `@opencoreagents/adapters-redis` | `RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus`, `RedisDynamicDefinitionsStore` | [06-adapters-infrastructure.md](./06-adapters-infrastructure.md), [19-cluster-deployment.md](./19-cluster-deployment.md) | [adapters-redis/README.md](../../packages/adapters-redis/README.md) |
| **Memory / RunStore / MessageBus / vector** (Upstash REST) | `@opencoreagents/adapters-upstash` | `UpstashRedisMemoryAdapter`, `UpstashRunStore`, `UpstashRedisMessageBus`, `UpstashVectorAdapter` | [06-adapters-infrastructure.md](./06-adapters-infrastructure.md), [17-rag-pipeline.md](./17-rag-pipeline.md) | [adapters-upstash/README.md](../../packages/adapters-upstash/README.md) |
| **Background jobs** | `@opencoreagents/adapters-bullmq` | `createEngineQueue`, `createEngineWorker`; re-exports `dispatchEngineJob` | [06-adapters-infrastructure.md](./06-adapters-infrastructure.md), [14-consumers.md](./14-consumers.md) | [adapters-bullmq/README.md](../../packages/adapters-bullmq/README.md) |
| **HTTP-backed tools** | `@opencoreagents/adapters-http-tool` | `registerHttpToolsFromDefinitions`, `createHttpToolAdapter` | [20-http-tool-adapter.md](./20-http-tool-adapter.md) | [adapters-http-tool/README.md](../../packages/adapters-http-tool/README.md) |
| **Definition store + hydrate** | `@opencoreagents/dynamic-definitions` | `DynamicDefinitionsStore`, `hydrateAgentDefinitionsFromStore`, `InMemoryDynamicDefinitionsStore` (Redis store class lives in **adapters-redis**) | [21-dynamic-runtime-rest.md](./21-dynamic-runtime-rest.md) | [dynamic-definitions/README.md](../../packages/dynamic-definitions/README.md) |

**Shipped in `@opencoreagents/core` (no extra adapter package):** **`InMemoryMemoryAdapter`** and **`InMemoryRunStore`** for single-process tests and local demos. They are **not** shared across machines; for production or multiple workers use Redis or Upstash implementations above.

**You implement yourself:** any store that satisfies **`MemoryAdapter`** / **`RunStore`** / **`MessageBus`** (or **`LLMAdapter`** for another model vendor). The loop does not care which database backs the interface.

## How to wire adapters into `AgentRuntime`

1. **Install** the packages you need (see table) — e.g. `pnpm add @opencoreagents/core @opencoreagents/adapters-openai @opencoreagents/adapters-redis`.
2. **Construct** provider-specific instances (Redis: `REDIS_URL`; Upstash: REST credentials from their dashboard; OpenAI: `OPENAI_API_KEY` — details in each README).
3. **Pass them into** **`new AgentRuntime({ … })`** once per process (API and workers must use the **same** shared adapters for memory / `RunStore` / `MessageBus` when a run can move between instances).

```typescript
import { AgentRuntime, InMemoryMemoryAdapter } from "@opencoreagents/core";
import { OpenAILLMAdapter } from "@opencoreagents/adapters-openai";
// import { RedisMemoryAdapter, RedisRunStore } from "@opencoreagents/adapters-redis";

const runtime = new AgentRuntime({
  llmAdapter: new OpenAILLMAdapter(process.env.OPENAI_API_KEY!),
  memoryAdapter: new InMemoryMemoryAdapter(),
  // runStore: new RedisRunStore(...),
  // messageBus: new RedisMessageBus(...),
});
```

After **`Agent.define` / `Agent.load`**, call **`Agent.run`** / **`Agent.resume`** (SDK) or **`executeRun`** / **`dispatchEngineJob`** (workers) as in [14-consumers.md](./14-consumers.md). **Runnable baseline:** [examples/minimal-run](../../examples/minimal-run) (in-memory + mock LLM); OpenClaw **`SKILL.md`** loading + **`exec`**: [examples/load-openclaw-skills](../../examples/load-openclaw-skills); swap adapters per READMEs for production.

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
