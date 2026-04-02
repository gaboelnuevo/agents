# Adapters: engine contracts

The engine core depends on **interfaces**, not specific databases. Two essential families: **memory** and **tools**.

## Memory adapter

Abstracts read/write by memory type. The engine (or dedicated tools) invokes it.

```typescript
interface MemoryAdapter {
  save(agentId: string, memoryType: string, content: unknown): Promise<void>;
  query(agentId: string, memoryType: string, filter?: unknown): Promise<unknown[]>;
  delete(agentId: string, memoryType: string, filter?: unknown): Promise<void>;
  getState(agentId: string): Promise<unknown>;
}
```

### Logical types (not all required in v1)

| Type | Use in the engine |
|------|-------------------|
| `shortTerm` | Recent turns injected into context. |
| `working` | Session/run variables (priority, flags). |
| `longTerm` | Persistence across runs. |
| `vectorMemory` | Semantic retrieval (optional). |

The **Context Builder** decides which branches to read and in what order to build the prompt.

## Tool adapter

The **ToolRunner** resolves `action.tool` → executing instance.

```typescript
interface ToolAdapter {
  name: string;
  execute(input: unknown, context: unknown): Promise<unknown>;
  validate?(input: unknown): boolean;
}
```

- **context**: typically includes `agentId`, `runId`, memory adapter reference, scoped credentials, etc.
- Output is normalized to an **observation** in history.

### Typical MVP engine tools

| Tool | Role |
|------|------|
| `save_memory` / `get_memory` | Bridge to MemoryAdapter. |
| `update_state` | Bounded working memory. |

Others (`http_request`, messages to other agents) are extensions: the **loop** stays the same.

## Hooks vs adapters

- **Hooks**: observe the run (`onAction`, …); they must not be the only path for business execution.
- **Adapters**: the **authorized** path for side effects from a valid `action`.

## Multi-agent (engine note)

A **MessageBus** does not replace ToolRunner: it is usually **another tool** (`send_message`) or a service injected in `context`. The engine remains one loop per agent; coordination is policy on top of the same `action` / `wait` / `resume` model. Detail: [09-communication-multiagent.md](./09-communication-multiagent.md).

## Job queue adapter (primary: BullMQ)

This is **not** a third core contract inside the loop (unlike `MemoryAdapter` / `ToolAdapter`). It is **pluggable infrastructure** used by **consumers**: workers dequeue jobs and call the same entry points as the SDK or REST — `run` / `resume` with `RunInput` / `ResumeInput`. The engine does not import BullMQ.

**Implementation priority:** **BullMQ on Redis** is the **first-supported** path for async work and for waking runs after `wait` with `reason: scheduled` (delayed jobs, retries, DLQ, horizontal workers). Ship this adapter before or alongside other deployment pieces.

| Use | Role |
|-----|------|
| **Background runs** | API or webhook enqueues work; worker invokes the engine — avoids HTTP timeouts, adds retries and DLQ. |
| **Scheduled `wait`** | Delayed or repeatable jobs call `resume(runId, …)` when `reason: scheduled`. |
| **MessageBus backend** | Optional: one queue (or set of queues) per agent / `projectId` for `send_message` delivery with ordering and retries — still exposed to the engine as the same bus contract ([09-communication-multiagent.md](./09-communication-multiagent.md)). |

**Redis:** BullMQ expects a Redis deployment that supports its commands and connection model. If you already use Redis for `MemoryAdapter`, you can use the **same cluster** or a **dedicated** Redis for queues; validate provider compatibility (some serverless Redis products differ — test before committing).

### Alternative: Upstash QStash

When you **do not** want Redis-backed workers (e.g. purely serverless HTTP callbacks), **QStash** can trigger `POST /runs/:id/resume` (or equivalent) after a delay — same semantics as a BullMQ delayed job from the engine’s perspective, different operational model. Use QStash as the **secondary** option when BullMQ is not a fit.

---

## Upstash (reference implementations)

**Redis** as `MemoryAdapter` (serverless persistence) and **Vector** for optional retrieval: same interfaces as on this page; scope in [06-mvp.md](./06-mvp.md#upstash-adapters-in-mvp). **Async / scheduled `resume`:** implement **BullMQ** first (above); **QStash** remains the documented **alternative** for HTTP-triggered wakeups without a worker process.
