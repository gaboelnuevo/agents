# Core: Agent Engine

**Condensed** documentation for the **execution engine** (stateful runtime): what it does, how it is structured, lifecycle, internal protocol, and adapter contracts. **Consumer** types (CLI, REST, MCP, …) at a high level only: [14-consumers.md](./14-consumers.md).

## Implementation status

The monorepo implements the engine, adapters (OpenAI; **TCP Redis** via `@agent-runtime/adapters-redis` as the **default** path for shared memory / RunStore / MessageBus; **Upstash REST** in `@agent-runtime/adapters-upstash` for HTTP-only Redis and **`UpstashVectorAdapter`**), **BullMQ-first** background execution via **`@agent-runtime/adapters-bullmq`** (typed queue/worker + `dispatchEngineJob` — see [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq)), RAG tools, multi-agent messaging, CLI/scaffold, **`RunStore`** for cluster **`wait`/`resume`**, optional **per-tool timeouts** (`configureRuntime({ toolTimeoutMs })`, `ToolTimeoutError` / `TOOL_TIMEOUT`), and the **direct worker API** (`buildEngineDeps`, `createRun`, `executeRun`). **CI:** GitHub Actions runs **`pnpm turbo run build test lint`** (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). Cluster + queue patterns: [19-cluster-deployment.md](./19-cluster-deployment.md). Roadmap: [Implementation plan](../plan.md). Gaps: [technical-debt.md](../technical-debt.md).

## Contents

| Doc | Topic |
|-----|--------|
| [01-purpose.md](./01-purpose.md) | Engine purpose, boundaries, layers (LLM vs engine) |
| [02-architecture.md](./02-architecture.md) | Internal components and responsibilities |
| [03-execution-model.md](./03-execution-model.md) | Run, states, loop, wait/resume |
| [04-protocol.md](./04-protocol.md) | Messages, envelope, engine rules |
| [05-adapters.md](./05-adapters.md) | Memory and Tool adapters; **`adapters-bullmq`** (priority queue); **QStash** alternative; **`adapters-redis`** (TCP, default for clusters); Upstash REST + vector |
| [06-mvp.md](./06-mvp.md) | Minimum engine scope and risks |
| [07-definition-syntax.md](./07-definition-syntax.md) | JSON + library `Tool.define` / `Skill.define` / `Agent.define`, `load`, `run` |
| [08-scope-and-security.md](./08-scope-and-security.md) | Scope (global, project, session, run) and **SecurityLayer** (authZ, control points) |
| [09-communication-multiagent.md](./09-communication-multiagent.md) | **MessageBus**, `send_message` tool, request–reply patterns and `wait`/`resume` across agents |
| [10-llm-adapter.md](./10-llm-adapter.md) | **LLMAdapter** contract: request/response, errors, JSON, streaming, multi-provider |
| [11-context-builder.md](./11-context-builder.md) | Prompt ordering, truncation, **SecurityContext** filtering, output to the LLM |
| [12-skills.md](./12-skills.md) | **Skills** vs **tools**, resolution, model visibility, optional `execute` |
| [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md) | Failures, **abort/timeout**, error taxonomy, parsing and **re-prompt** for `Step` |
| [14-consumers.md](./14-consumers.md) | Engine **consumers**: SDK, CLI, REST, MCP, webhooks, cron (overview) |
| [15-multi-tenancy.md](./15-multi-tenancy.md) | **Multi-tenancy**: organizations, projects, end-users, memory scoping |
| [16-utils.md](./16-utils.md) | **Utils**: parsers, chunking, file-resolver — internal utilities for tools |
| [17-rag-pipeline.md](./17-rag-pipeline.md) | **RAG pipeline**: EmbeddingAdapter, VectorAdapter, RAG tools, agent patterns |
| [18-scaffold.md](./18-scaffold.md) | **Scaffold**: CLI `init` / `generate`, project templates, bootstrapping API |
| [19-cluster-deployment.md](./19-cluster-deployment.md) | **Cluster**: per-process vs shared, RunStore, MessageBus (**Redis TCP** preferred, Upstash REST optional), BullMQ/QStash (planned), horizontal scaling |

## In one sentence

The **engine** builds context, calls the LLM, **interprets** outputs, **executes** tools via adapters, **persists** state/memory, and **controls** the loop (including the `wait` pause).

## Origin

Derived and reorganized from `docs/brainstorm/` and the *Agentes AI* PDF thread.
