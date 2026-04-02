# Internal engine architecture

## Component view

All external entry should pass through the **SecurityLayer** first (see [08-scope-and-security.md](./08-scope-and-security.md)).

```
                    ┌───────────────────┐
  input (run) ────► │  SecurityLayer    │
                    │  (authN / authZ)  │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌─────────────┐
                    │   Engine    │
                    │ (orchestr.) │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │  Context   │  │ LLM        │  │ ToolRunner │
    │  Builder   │  │ Adapter    │  │ (+registry)│
    └────────────┘  └────────────┘  └─────┬──────┘
           │               │               │
           │               │               ▼
           │               │        Tool adapters
           ▼               │
    Memory (via           │
    MemoryAdapter) ◄───────┘
           │
           ▼
    Run store (run state: waiting, history, snapshot)
```

## Responsibilities

| Piece | Responsibility |
|-------|----------------|
| **Context Builder** | Assemble what the model “sees”: system, input, memory (short / long / working), catalog of available tools/skills. Detail: [11-context-builder.md](./11-context-builder.md). |
| **LLM Adapter** | A uniform call; no agent business logic. Detail: [10-llm-adapter.md](./10-llm-adapter.md). |
| **Engine (loop)** | Interpret LLM output (e.g. JSON), branch: `thought` / `action` / `wait` / `result`, apply limits and validation. Errors and parsing: [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md). |
| **ToolRunner** | Resolve tool name → adapter; `validate?` → `execute` → return observation to history. |
| **Memory** | Accessed only via **MemoryAdapter** (or tools that use it); the engine core does not couple to Mongo/Redis. |
| **Run / AgentExecution** | `runId`, `status`, `history`, `state` for wait/resume and debugging. |
| **SecurityLayer** | Validates identity and permissions; attaches `SecurityContext` to the run; does not execute tools. |
| **Scope** | `projectId`, `sessionId`, and global vs project resolution for definitions and memory (see doc 08). |

## Suggested modules (implementation)

| Module | Typical contents |
|--------|------------------|
| `Agent` | Static or loaded definition: id, system prompt, skills/tools lists, memory config. |
| `AgentExecution` | A run instance: loop, outward hooks, intermediate state persistence. |
| `Skills` | Resolve skills referenced by the agent (handlers or templates). See [12-skills.md](./12-skills.md). |
| `LLMAdapter` | OpenAI, Anthropic, etc. Contract in [10-llm-adapter.md](./10-llm-adapter.md). |
| `ToolRunner` | Registry `name → ToolAdapter`. |

**CLI** and **REST API** are **clients** of the same engine; they do not duplicate loop logic. Other consumers: [14-consumers.md](./14-consumers.md).

## Data flow (summary)

1. `run(input)` creates or reuses session context per policy.
2. Context Builder reads memory via adapter.
3. LLM Adapter generates (ideally JSON with step type).
4. Engine applies state transitions and side effects (tools, memory, wait).
5. Until `result`, `failed`, or `waiting` + persistence for `resume`.
