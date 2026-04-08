# Engine purpose and boundaries

## What the engine is

An **Agent Engine** (or *runtime*) that:

- Maintains **identity and state** for the agent across steps and, with adapters, across executions.
- Orchestrates **skills** (capabilities) and **tools** (actions executed under its control).
- Runs a closed **loop**: reason → (optional) act → observe → update memory → repeat, finish, or **wait**.

The LLM is only the **inference engine**; the engine is the **control system**.

Related: [02-architecture.md](./02-architecture.md) (components and data flow), [19-cluster-deployment.md](./19-cluster-deployment.md) (per-process **`AgentRuntime`**, **`RunStore`**, **`messageBus`**).

## Purpose in one line

> Give agents **memory**, **capabilities**, and **execution control** **without** coupling to a specific model vendor.

## Layers (conceptual order)

| Layer | Role |
|-------|------|
| **LLM Adapter** | `generate(...)`: swappable provider and model. See [10-llm-adapter.md](./10-llm-adapter.md). |
| **Agent Engine** | Loop, context, decision parsing, tools, memory, wait/resume. Errors/parsing: [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md). |
| **Tools** | Adapter registry; the model **proposes**, the engine **executes**. |
| **Context Builder** | Assembles the prompt; see [11-context-builder.md](./11-context-builder.md). |
| **Skills** | Higher-level capabilities; see [12-skills.md](./12-skills.md). |

MCP or other external buses are **optional**: they connect *tools*, they do not replace the engine.

## What the engine is **not** (v1)

- A generic chat wrapper with no state of its own.
- A visual builder or SaaS product.
- Unlimited autonomy with no iteration ceiling or validation.

## Design principle

Start with **semi-agents**: few decisions per request, bounded loop, strict JSON. Scale autonomy when control and tests allow.

## Feature filter

Does the feature make the agent more **autonomous**, more **traceable**, or more **able to act** under rules? If not, keep it out of core or defer it.
