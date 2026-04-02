# Core: Agent Engine

**Condensed** documentation for the **execution engine** (stateful runtime): what it does, how it is structured, lifecycle, internal protocol, and adapter contracts. **Consumer** types (CLI, REST, MCP, …) at a high level only: [14-consumers.md](./14-consumers.md).

## Contents

| Doc | Topic |
|-----|--------|
| [01-purpose.md](./01-purpose.md) | Engine purpose, boundaries, layers (LLM vs engine) |
| [02-architecture.md](./02-architecture.md) | Internal components and responsibilities |
| [03-execution-model.md](./03-execution-model.md) | Run, states, loop, wait/resume |
| [04-protocol.md](./04-protocol.md) | Messages, envelope, engine rules |
| [05-adapters.md](./05-adapters.md) | Memory and Tool adapters; **BullMQ** primary job queue; **QStash** alternative; Upstash Redis/Vector |
| [06-mvp.md](./06-mvp.md) | Minimum engine scope and risks |
| [07-definition-syntax.md](./07-definition-syntax.md) | JSON + library `Tool.define` / `Skill.define` / `Agent.define`, `load`, `run` |
| [08-scope-and-security.md](./08-scope-and-security.md) | Scope (global, project, session, run) and **SecurityLayer** (authZ, control points) |
| [09-communication-multiagent.md](./09-communication-multiagent.md) | **MessageBus**, `send_message` tool, request–reply patterns and `wait`/`resume` across agents |
| [10-llm-adapter.md](./10-llm-adapter.md) | **LLMAdapter** contract: request/response, errors, JSON, streaming, multi-provider |
| [11-context-builder.md](./11-context-builder.md) | Prompt ordering, truncation, **SecurityContext** filtering, output to the LLM |
| [12-skills.md](./12-skills.md) | **Skills** vs **tools**, resolution, model visibility, optional `execute` |
| [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md) | Failures, **abort/timeout**, error taxonomy, parsing and **re-prompt** for `Step` |
| [14-consumers.md](./14-consumers.md) | Engine **consumers**: SDK, CLI, REST, MCP, webhooks, cron (overview) |

## In one sentence

The **engine** builds context, calls the LLM, **interprets** outputs, **executes** tools via adapters, **persists** state/memory, and **controls** the loop (including the `wait` pause).

## Origin

Derived and reorganized from `docs/brainstorm/` and the *Agentes AI* PDF thread.
