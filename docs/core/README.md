# Core: Agent Engine

**Condensed** documentation for the **execution engine** (stateful runtime): what it does, how it is structured, lifecycle, internal protocol, and adapter contracts. **Consumer** types (CLI, REST, MCP, …) at a high level only: [14-consumers.md](./14-consumers.md).

## Implementation status

The monorepo implements the engine, adapters (**OpenAI** and **Anthropic**; **TCP Redis** via `@opencoreagents/adapters-redis` as the **default** path for shared memory / RunStore / MessageBus; **Upstash REST** in `@opencoreagents/adapters-upstash` for HTTP-only Redis and **`UpstashVectorAdapter`**; **JSON-configured outbound HTTP tools** via **`@opencoreagents/adapters-http-tool`** — [20-http-tool-adapter.md](./20-http-tool-adapter.md); **definition store + CRUD facade** (**`DynamicDefinitionsStore`**: **`store.methods`** + **`store.Agent`**, …) via **`@opencoreagents/dynamic-definitions`** — [21-dynamic-runtime-rest.md](./21-dynamic-runtime-rest.md)), an Express JSON router (**`@opencoreagents/rest-api`**, **`createRuntimeRestRouter`**, contract in [plan-rest.md](../planning/plan-rest.md)) — [14-consumers.md §REST](./14-consumers.md), **`@opencoreagents/conversation-gateway`** for inbound message normalization, **BullMQ-first** background execution via **`@opencoreagents/adapters-bullmq`** (typed queue/worker; **`dispatchEngineJob(runtime, payload)`** is implemented in **`@opencoreagents/core`** and re-exported from **`adapters-bullmq`** — see [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq)), RAG tools + **per-project file catalog** on **`AgentRuntime`**, multi-agent messaging, CLI/scaffold, **`RunStore`** for cluster **`wait`/`resume`**, optional **per-tool timeouts** and **session expiry** on **`AgentRuntime`** / **`Session`** (`toolTimeoutMs`, `SessionOptions.expiresAtMs`), and the **direct worker API** (`buildEngineDeps`, `createRun`, `executeRun`). **CI:** GitHub Actions runs **`pnpm turbo run build test lint`** with **Redis** + **`REDIS_INTEGRATION=1`** for BullMQ integration (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)); **`packages/core/tests`** covers hooks, multi-agent, memory scope, parse recovery, RAG catalog, vector caps, system_send_message policy, and related integration paths — see [Implementation plan §Progress snapshot](../planning/plan.md). Cluster + queue patterns: [19-cluster-deployment.md](./19-cluster-deployment.md). Gaps and deferrals: [technical-debt.md](../planning/technical-debt.md).

## Contents

| Doc | Topic |
|-----|--------|
| [01-purpose.md](./01-purpose.md) | Engine purpose, boundaries, layers (LLM vs engine) |
| [02-architecture.md](./02-architecture.md) | Internal components and responsibilities |
| [03-execution-model.md](./03-execution-model.md) | Run, states, loop, wait/resume, **RunStore** |
| [04-protocol.md](./04-protocol.md) | Messages, envelope, engine rules, durable **waiting** |
| [05-adapters.md](./05-adapters.md) | Memory, Tool, **RunStore**; **`adapters-bullmq`** (priority queue); **QStash** alternative; **`adapters-redis`** (TCP, default for clusters); Upstash REST + vector; **`adapters-http-tool`**; **`dynamic-definitions`** (store facade: **`store.methods`** + **`store.Agent`**, per-job hydrate) |
| [06-mvp.md](./06-mvp.md) | Minimum engine scope, adapters, **RunStore** / cluster resume, risks |
| [07-definition-syntax.md](./07-definition-syntax.md) | JSON + library `Tool.define` / `Skill.define` / `defineBatch` / `Agent.define`, `SkillDefinitionPersisted`, `load`, `run` |
| [08-scope-and-security.md](./08-scope-and-security.md) | Scope, **SecurityLayer**, **§7 production checklist**, [`technical-debt-security-production.md`](../planning/technical-debt-security-production.md) §1–§3 |
| [09-communication-multiagent.md](./09-communication-multiagent.md) | **MessageBus** + **`AgentRuntime`**, `system_send_message`, `wait`/`resume` across agents |
| [10-llm-adapter.md](./10-llm-adapter.md) | **LLMAdapter** contract; wiring via **`AgentRuntime`** (`llmAdapter` / `llmAdaptersByProvider`) |
| [11-context-builder.md](./11-context-builder.md) | Prompt ordering, truncation, **effectiveToolAllowlist** (registry ∩ agent/skills); **SecurityContext** not applied to prompt tools yet ([08](./08-scope-and-security.md) §2), **Step** shape |
| [12-skills.md](./12-skills.md) | **Skills** vs **tools**, resolution, **`defineBatch`**, optional `execute`, store JSON |
| [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md) | Failures, **abort/timeout**, error taxonomy, parsing and **re-prompt** for `Step` |
| [14-consumers.md](./14-consumers.md) | Engine **consumers**: SDK, BullMQ, CLI, REST, MCP; **production** auth/tenant note |
| [15-multi-tenancy.md](./15-multi-tenancy.md) | **Multi-tenancy**: organizations, projects, end-users, memory scoping |
| [16-utils.md](./16-utils.md) | **Utils**: parsers, chunking, file-resolver — internal utilities for tools |
| [17-rag-pipeline.md](./17-rag-pipeline.md) | **RAG pipeline**: EmbeddingAdapter, VectorAdapter, RAG tools, agent patterns |
| [18-scaffold.md](./18-scaffold.md) | **Scaffold**: CLI `init` / `generate`, project templates, bootstrapping API |
| [19-cluster-deployment.md](./19-cluster-deployment.md) | **Cluster**: per-process vs shared, RunStore, MessageBus (**Redis TCP** preferred, Upstash REST optional), BullMQ/QStash (planned), horizontal scaling |
| [20-http-tool-adapter.md](./20-http-tool-adapter.md) | **HTTP tools from JSON**: `@opencoreagents/adapters-http-tool`, templates, `allowedHosts`, `registerHttpToolsFromDefinitions` |
| [21-dynamic-runtime-rest.md](./21-dynamic-runtime-rest.md) | **Dynamic definitions**: `@opencoreagents/dynamic-definitions`, **`DynamicDefinitionsStore`** facade (**`store.methods`** + **`store.Agent` / `Skill` / `HttpTool`**), **`hydrateAgentDefinitionsFromStore`**, **`AgentRuntime.dynamicDefinitionsStore`** + **`dispatch`**, optional **`syncProjectDefinitionsToRegistry`**, example **`dynamic-runtime-rest`** |

## In one sentence

The **engine** builds context, calls the LLM, **interprets** outputs, **executes** tools via adapters, **persists** state/memory, and **controls** the loop (including the `wait` pause).

## Origin

Derived and reorganized from `docs/brainstorm/` and the *Agentes AI* PDF thread.
