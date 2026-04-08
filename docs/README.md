# Agent Engine

A **stateful agent runtime** for Node.js.

Developer **monorepo** entry (packages, `pnpm` commands): [README](../README.md) at the repository root.

> **Name TBD.** There is no final product, org, or npm scope name yet. The repository folder is a working codename only — it is **not** the intended public brand.

Not a chat wrapper. Not a prompt chain. Not a graph orchestrator.

A **control system** where the LLM proposes and the engine decides — with layered memory that persists across runs, tools that only the engine can execute, skills that shape agent behavior, multi-agent coordination via a message bus, and durable pauses until the real world responds.

### Current repository status

Nine workspace packages (`core`, `utils`, `adapters-openai`, `adapters-upstash`, `adapters-redis`, **`adapters-bullmq`**, `rag`, `scaffold`, `cli`) build and test together. **BullMQ** (`@agent-runtime/adapters-bullmq`) is the **priority** path for background runs and workers (`createEngineQueue`, `dispatchEngineJob`, …). **TCP Redis** adapters are the **default** for shared engine state; pair with the same Redis for queues when it fits ops. **Upstash REST** + **Upstash Vector** when you want HTTP-only Redis. **Per-tool timeouts**: `configureRuntime({ toolTimeoutMs })`. **CI**: `pnpm turbo run build test lint` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Roadmap: [`plan.md`](./plan.md); gaps: [`technical-debt.md`](./technical-debt.md).

---

## Why this exists

Most "AI agents" collapse two things that should be separate: the **model** and the **control system**. The result is brittle — the model hallucinates a tool call, history lives only in the prompt, state gets lost between runs, and there's no safe way to pause until a human or an external system responds.

This engine separates them clearly:

> **The LLM is the inference engine. The Agent Engine is the control system.**

The model never executes a tool directly. Every side effect goes through the engine. History is append-only and lives outside the model. State persists durably. Pauses are first-class.

---

## The loop

Every execution is a `Run`. Each run follows a closed, typed loop:

```
thought → action → observation → (repeat) → result
                        ↓
                      wait  ←→  resume
```

| Step | Produced by | What it means |
|------|-------------|---------------|
| `thought` | LLM | Intermediate reasoning. No side effects. |
| `action` | LLM | Proposal: call this tool with this input. |
| `observation` | Engine / ToolRunner | The actual result after the engine executes. |
| `wait` | LLM | Durable pause — waiting for user input, a webhook, or a scheduled event. |
| `result` | LLM | Final output to the caller. |

The engine parses each LLM turn as a single typed JSON step and branches accordingly. Invalid JSON, unknown tools, or exceeded limits do not crash the run — they trigger bounded recovery or a controlled failure.

---

## Engine invariants

These are not configurable. They are what makes the engine predictable:

1. **The LLM proposes. The ToolRunner executes.** The model emits an `action`; the engine validates it and materializes the effect.
2. **All side effects go through the engine.** Permissions, limits, logging — no shortcuts.
3. **History is immutable.** Append only. Never rewritten.
4. **Durable state lives outside the prompt.** Memory, pending `wait`, snapshots — in adapters, not in volatile model context.

---

## Dynamic agent definitions

Agents, tools, and skills are **defined once and persisted to a store** (TCP Redis, Upstash REST, or any adapter). Any process — SDK, CLI, REST, or an MCP server that proxies to the same API — can load them by ID without redeployment. You can create a new agent at runtime, update its config, and the next `Agent.load` picks it up immediately.

```
Tool.define()     →  stored in registry (global or per project)
Skill.define()    →  stored, references tools by id
Agent.define()    →  stored, references skills + tools + memory policy + LLM config
                             │
                    Agent.load("id", { session })
                             │
                    .run()  →  loop  →  .resume()
```

**`scope: "global"`** makes a tool or skill available across all projects.
**`projectId`** isolates it to a single tenant — another project cannot see or use it.

### 1. Register tools

Tools are the executable primitives. The engine — never the LLM — runs them.

```typescript
import { Tool } from "@agent-runtime/core";

// Global: available to any agent in any project
await Tool.define({
  id: "save_memory",
  scope: "global",
  description: "Persists a fragment in the agent's memory.",
  inputSchema: {
    type: "object",
    properties: {
      memoryType: { enum: ["shortTerm", "longTerm", "working"] },
      content: {},
    },
    required: ["memoryType", "content"],
  },
});

// Project-scoped: only visible inside "acme-corp"
await Tool.define({
  id: "trigger_workflow",
  projectId: "acme-corp",
  description: "Triggers an Upstash workflow and returns status.",
  inputSchema: {
    type: "object",
    properties: {
      flowId: { type: "string" },
      params:  { type: "object" },
    },
    required: ["flowId"],
  },
  roles: ["operator", "admin"],
});
```

### 2. Register skills

Skills group tools and shape how the agent is prompted. They can be declarative (context only) or imperative (run code directly).

```typescript
import { Skill } from "@agent-runtime/core";

// Declarative: injects domain context, restricts visible tools
await Skill.define({
  id: "intakeSummary",
  scope: "global",
  tools: ["save_memory", "get_memory"],
  description: "Summarizes structured intake (tickets, forms, events) and may persist notes.",
});

// Imperative: deterministic logic, no LLM needed
await Skill.define({
  id: "priorityEstimate",
  projectId: "acme-corp",
  tools: ["save_memory"],
  execute: async ({ input, context }) => {
    const ageHours = (input as any).ticketAgeHours ?? 0;
    return { suggestedPriority: ageHours > 24 ? "high" : "normal" };
  },
  roles: ["operator"],
});
```

### 3. Define an agent

An agent definition is a config object stored in the DB. It declares which skills and tools it can use, its memory policy, LLM settings, and who is allowed to run it.

```typescript
import { Agent } from "@agent-runtime/core";

await Agent.define({
  id: "ops-analyst",
  name: "Ops analyst",
  projectId: "acme-corp",
  systemPrompt:
    "You triage operational intake (tickets, tasks, alerts). Each turn respond with a single JSON Step object " +
    "(type: thought | action | wait | result).",
  skills: ["intakeSummary", "priorityEstimate"],
  tools: ["save_memory", "get_memory", "trigger_workflow"],
  memoryConfig: {
    shortTerm: { maxTurns: 10 },
    longTerm: true,
    working: {},
  },
  llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
  security: { roles: ["operator", "admin"] },
});
// ✓ Persisted to store. No redeployment needed.
// ✓ Any process that has access to the same store can now Agent.load("ops-analyst").
```

### 4. Load and run

```typescript
import { Agent, Session } from "@agent-runtime/core";

// Session scopes memory and history — isolated per user or business cycle
const session = new Session({ id: "queue-east-2026-04-02", projectId: "acme-corp" });

// Loads the definition from the store, resolves skills and tools
const agent = await Agent.load("ops-analyst", { session });

// Promise-style SDK with per-step hooks
await agent
  .run("Ticket #4412: refund still pending after 5 business days — what should we do next?")
  .onThought((t)      => console.debug("[thought]",      t.content))
  .onAction((a)       => console.debug("[action]",       a.tool, a.input))
  .onObservation((o)  => console.debug("[observation]",  o))
  .onWait(async (w)   => {
    // agent paused — provide input to resume
    if (w.reason === "user_input") return prompt(w.details.question);
  })
  .then((result)      => console.log("[result]", result.content));
```

### 5. Resume after a wait

When a run pauses (`status: waiting`), it is persisted to the store. Resume it from anywhere — another request, a webhook handler, a cron job:

```typescript
// From a webhook, a CLI command, or a REST endpoint:
await agent.resume(runId, { type: "text", content: "approved — escalate to billing" });
// The loop picks up exactly where it left off.
```

---

## Layered memory

Memory is not a flat key-value store. It's layered by purpose, accessed only through the `MemoryAdapter` interface — swappable between in-memory, TCP Redis (`adapters-redis`), Upstash REST, Postgres, or anything else:

| Layer | Purpose |
|-------|---------|
| `shortTerm` | Recent turns injected into context. Bounded by `maxTurns`. |
| `working` | Session/run variables: flags, priority, intermediate state. |
| `longTerm` | Persistence across runs. Loaded selectively by the Context Builder. |
| `vectorMemory` | Semantic retrieval for relevant past context (optional). |

```typescript
interface MemoryAdapter {
  save(agentId: string, memoryType: string, content: unknown): Promise<void>;
  query(agentId: string, memoryType: string, filter?: unknown): Promise<unknown[]>;
  getState(agentId: string): Promise<unknown>;
}
```

The engine never couples to a specific store. Swap adapters in the factory; the loop does not change.

---

## Skills vs tools

**Tools** are executable effects — HTTP calls, memory writes, external triggers. The LLM proposes them via `action`; the ToolRunner runs them.

**Skills** are higher-level capabilities that shape *how* an agent behaves — they group related tools, inject additional context into the prompt, and can carry optional imperative logic:

```typescript
// Declarative skill: shapes context, restricts tool subset
await Skill.define({
  id: "policyGuard",
  projectId: "acme-corp",
  tools: ["get_memory"],
  description: "Only recommend actions that pass policy thresholds.",
  roles: ["operator"],
});

// Imperative skill: deterministic logic without LLM
await Skill.define({
  id: "priorityEstimate",
  projectId: "acme-corp",
  tools: ["save_memory"],
  execute: async ({ input, context }) => {
    const ageHours = (input as any).ticketAgeHours ?? 0;
    return { suggestedPriority: ageHours > 24 ? "high" : "normal" };
  },
  roles: ["operator"],
});
```

The LLM still only emits standard `Step` JSON — skills never bypass the protocol.

---

## Multi-agent coordination

Agents communicate via a **MessageBus** — not shared state, not a mega-model with multiple voices. Each agent has its own loop. Coordination happens through structured messages and `wait` / `resume`:

```
Agent A                MessageBus              Agent B
   │                       │                      │
   ├──action send_message──►│                      │
   │                       ├──deliver message──────►│
   ├──step wait ───────────►│                      │
   │  (status: waiting)     │                 B processes
   │                       │◄──reply (correlationId)─┤
   ◄──resume(runId, payload)┤                      │
   │                        │                      │
   └──loop continues → result
```

```typescript
// Agent A sends a request and waits for the reply
await agentA
  .run("Ask the policy agent whether we can auto-approve this refund")
  .onWait(async (w) => {
    if (w.details?.kind === "agent_reply") {
      return messageBus.waitFor(agentA.id, {
        correlationId: w.details.correlationId,
        timeoutMs: 30_000,
      });
    }
  })
  .then((r) => console.log(r));
```

Messages are scoped to `projectId` by default — no cross-tenant leakage.

---

## Production Redis and Upstash

The engine uses **interfaces**; production usually wires **`configureRuntime`** with shared stores. Prefer **TCP Redis** (`@agent-runtime/adapters-redis`) when you have a normal `REDIS_URL` — it matches **BullMQ** and typical deployments. Use **`@agent-runtime/adapters-upstash`** for **REST** Redis, **Upstash Vector**, or serverless-friendly HTTP access.

| Piece | Typical choice |
|-------|----------------|
| **TCP Redis** (`ioredis`) | `RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus` in `@agent-runtime/adapters-redis` — **default** for cluster memory, `wait`/`resume` across workers, and `send_message`. |
| **Upstash REST** | `UpstashRedisMemoryAdapter`, `UpstashRunStore`, `UpstashRedisMessageBus` when you want HTTP-only Redis. |
| **Upstash Vector** | `UpstashVectorAdapter` for `vector_search` / RAG — lives in `@agent-runtime/adapters-upstash`. |
| **BullMQ (primary job queue)** | Not shipped in-repo; your worker calls `buildEngineDeps` + `executeRun` — [`core/05-adapters.md`](./core/05-adapters.md#job-queue-adapter-primary-bullmq). |
| **Upstash QStash (alternative)** | HTTP callback to `resume` after a scheduled `wait` if you skip BullMQ workers — same wake semantics, different ops model. |

```typescript
import { configureRuntime } from "@agent-runtime/core";
import { RedisMemoryAdapter, RedisRunStore } from "@agent-runtime/adapters-redis";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);
configureRuntime({
  memoryAdapter: new RedisMemoryAdapter(redis),
  runStore: new RedisRunStore(redis),
  // llmAdapter, …
});
// Same engine and loop; swap adapters for local dev or Upstash REST.
```

**BullMQ** is the **default job-queue path** to implement in your app (not a third engine interface). **QStash** is the **alternative** when you want serverless HTTP wakeups instead of Redis workers.

---

## Consumers (brief overview)

Anything that **starts** or **inspects** a run ultimately hits the same **Agent Engine** (and **SecurityLayer** when the call crosses a trust boundary). The loop is implemented once; consumers only differ in how they package input and credentials.

| Surface | Role |
|---------|------|
| **SDK** | In-process: `Agent.load`, `.run()`, `.resume()`, hooks — see [§4. Load and run](#4-load-and-run) above. |
| **CLI** | Human-friendly commands for run, resume, logs, memory, and inter-agent `send`; delegates to the library. |
| **REST** | HTTP/JSON for remote apps, dashboards, and BFFs — same semantics as the SDK after auth. |
| **MCP** | **Model Context Protocol**: IDEs and assistants expose **tools** to their model; an MCP server can **proxy** those tool calls to your REST or SDK. MCP wires interoperability; it does **not** replace engine memory, history, or ToolRunner ([`core/01-purpose.md`](./core/01-purpose.md), [`core/14-consumers.md`](./core/14-consumers.md)). |

### CLI (example)

```bash
# Run an agent
agent-cli run ops-analyst --session queue-today --input "Ticket #4412 still pending — next step?"

# Resume a paused run
agent-cli resume <runId> --input "approved — escalate to billing"

# Inspect run history
agent-cli logs <runId>

# Read agent memory for a session
agent-cli memory ops-analyst --session queue-today

# Send a message to another agent
agent-cli send ops-analyst policy-checker --message '{"type":"request","task":"check refund policy"}'
```

### REST (example)

```http
POST  /agents/:id/run         → start a run
POST  /runs/:runId/resume     → resume a waiting run
GET   /runs/:runId            → run status + history
GET   /agents/:id/memory      → agent memory for a session
POST  /agents                 → Agent.define() over HTTP
POST  /agents/:id/send        → send message to another agent
```

All REST routes pass through the SecurityLayer before reaching the engine. Auth, project isolation, and quota checks happen there — the engine loop never changes.

### MCP (example)

Illustrative only: MCP tools are named handlers the host model can call; implementations forward to the same operations as CLI/REST.

```json
{
  "tools": [
    {
      "name": "agent_run",
      "description": "Start a run for an agent by id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "agentId": { "type": "string" },
          "sessionId": { "type": "string" },
          "input": { "type": "string" }
        },
        "required": ["agentId", "input"]
      }
    },
    {
      "name": "agent_resume",
      "description": "Resume a run that is waiting for input.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "runId": { "type": "string" },
          "input": { "type": "string" }
        },
        "required": ["runId", "input"]
      }
    }
  ]
}
```

A real MCP server would implement `agent_run` → `POST /agents/:id/run` (or in-process `agent.run(...)`) and `agent_resume` → `POST /runs/:runId/resume` (or `agent.resume(...)`), matching the CLI and REST flows.

---

## Architecture

```
Client (SDK / CLI / REST / MCP)
         │
         ▼
  SecurityLayer          ← authN + authZ per project and scope
         │
         ▼
   Agent Engine          ← loop, Step parsing, limits, hooks
    ┌────┴──────────┐
    │               │
Context Builder   ToolRunner   ← name → ToolAdapter
    │               │
    │          Tool adapters
    ▼          (memory, http, send_message, …)
MemoryAdapter  ← shortTerm / working / longTerm / vector
    │
Run store      ← runId, status, history, state (wait/resume)
```

**Scopes** isolate data and definitions across the system:

| Scope | Identifier | What it isolates |
|-------|------------|------------------|
| Global | `scope: "global"` | Shared tools and skills across all projects |
| Project | `projectId` | A tenant's agents, tools, memory, and message routes |
| Session | `sessionId` | Conversation history and working memory per user or cycle |
| Run | `runId` | One execution: history, waiting state, resume snapshot |

---

## Current status

> **Design complete → implementation starting.**

The architecture, contracts, protocol, and adapter interfaces are fully documented in `docs/core/`. The engine code does not exist yet. That is what we are building.

If you are reading this, you are one of the first.

---

## Contributing — where to start

### Read this first (in order)

| Doc | What it covers |
|-----|----------------|
| [`core/01-purpose.md`](./core/01-purpose.md) | What the engine is and what it is NOT |
| [`core/03-execution-model.md`](./core/03-execution-model.md) | Run entity, states, loop, wait/resume |
| [`core/04-protocol.md`](./core/04-protocol.md) | Message protocol and invariants |
| [`core/05-adapters.md`](./core/05-adapters.md) | MemoryAdapter and ToolAdapter contracts |
| [`core/06-mvp.md`](./core/06-mvp.md) | MVP scope and suggested implementation order |

### What needs to be built (MVP)

```
src/
  engine/
    AgentEngine.ts       # main loop
    AgentExecution.ts    # Run entity: status, history, state
    ToolRunner.ts        # registry + execute + validate
    types.ts             # Step, Run, SecurityContext, HistoryEntry
  adapters/
    memory/
      InMemoryAdapter.ts
  tools/
    save_memory.ts
    get_memory.ts
```

**MVP success criteria:**
- The agent remembers across executions (via `MemoryAdapter`)
- A run can pause (`wait`) and continue with new input (`resume`)
- Tools only execute after a validated `action` from the engine
- Same behavior invoked from SDK or HTTP

### Full reference docs

| Doc | Topic |
|-----|-------|
| [`core/02-architecture.md`](./core/02-architecture.md) | Internal components and responsibilities |
| [`core/07-definition-syntax.md`](./core/07-definition-syntax.md) | Full `Tool.define` / `Skill.define` / `Agent.define` shapes and types |
| [`core/08-scope-and-security.md`](./core/08-scope-and-security.md) | Multi-tenant scopes and SecurityLayer |
| [`core/09-communication-multiagent.md`](./core/09-communication-multiagent.md) | MessageBus, `send_message`, request-reply patterns |
| [`core/10-llm-adapter.md`](./core/10-llm-adapter.md) | LLMAdapter contract — multi-provider, streaming, errors |
| [`core/11-context-builder.md`](./core/11-context-builder.md) | Prompt assembly, truncation, SecurityContext filtering |
| [`core/12-skills.md`](./core/12-skills.md) | Skills vs tools — resolution, model visibility, imperative execute |
| [`core/13-errors-parsing-and-recovery.md`](./core/13-errors-parsing-and-recovery.md) | Failures, timeouts, bounded re-prompt |
| [`core/14-consumers.md`](./core/14-consumers.md) | SDK, CLI, REST, MCP, webhooks, cron |

---

## Design principles

- **Semi-agent first.** Few decisions per request, bounded loop, strict JSON. Autonomy scales when control is proven.
- **Adapters, not vendors.** TCP Redis, Postgres, Upstash REST, in-memory — swappable by design. The engine core never imports a specific store.
- **Traceability as a primitive.** If you can't reproduce and audit a run step by step, it's not production-ready.
- **One engine, multiple consumers.** SDK, CLI, REST, and MCP-oriented surfaces share the same loop semantics when they delegate into the engine. No duplicated loop logic across entry points.

---

## Operational best practices

- **Validate `inputSchema`** on every `Tool.define` — the ToolRunner rejects malformed inputs before executing.
- **Set `security.roles`** on agents that access sensitive data or destructive tools.
- **Cap `maxIterations`** from the start — prevents infinite loops and unexpected LLM cost.
- **Namespace Redis keys** as `{projectId}:{agentId}:{sessionId}:*` — never mix tenants in the same keyspace.
- **Version agent definitions** — store a `version` field in `Agent.define` to avoid conflicts with active runs during updates.
- **TTL on session memory** — expire `shortTerm` and `working` after the session ends; don't let Redis accumulate stale state.
- **Log by `runId` and `agentId`** — `onAction` and `onObservation` hooks are the natural audit points.
- **Clean up Vector embeddings** by `sessionId` or age — Upstash Vector is not a permanent archive by default.

---

## Brainstorm

Documents in [`brainstorm/`](./brainstorm/) are the design process notes — useful for understanding *why* decisions were made, not as final specification. The PRD overview is at [`brainstorm/12-prd-overview.md`](./brainstorm/12-prd-overview.md).
