# Core engine (summary of `docs/core`)

This document **summarizes** the execution engine specification documented in [`docs/core/`](../core/README.md). It bridges brainstorm (vision) and detailed technical contracts.

---

## In one sentence

The **engine** builds context, calls the LLM, **interprets** outputs (`Step`), **executes** tools via adapters, **persists** state/memory, and **controls** the loop (including the `wait` pause).

---

## Purpose and boundaries

- The LLM is **inference** only; the engine is the **control system**: identity, state, skills, tools, and closed loop (reason → act → observe → memory → repeat, finish, or **wait**).
- Explicit goal: give agents **memory**, **capabilities**, and **execution control** **without** coupling to a model vendor.
- **Not** (mental v1): stateless chat wrapper, visual builder, unlimited autonomy without iteration caps or validation.
- Principle: start with **semi-agents** (few decisions per request, strict JSON, bounded loop).

Detail: [`01-purpose.md`](../core/01-purpose.md).

---

## Internal architecture

All input goes through **SecurityLayer** (authN/authZ) first; then the **Engine** orchestrates:

| Piece | Short role |
|-------|------------|
| **Context Builder** | Assembles what the model “sees”: system, input, memory (short/long/working), filtered tool/skill catalog. |
| **LLM Adapter** | `generate(...)`: swappable provider, no agent business logic. |
| **ToolRunner** | `action` → registered adapter → `validate?` → `execute` → **observation** in history. |
| **Memory** | Only via **MemoryAdapter**; core does not couple to Mongo/Redis. |
| **AgentExecution / Run** | `runId`, `status`, `history`, `state` for wait/resume and debugging. |

CLI and REST are **clients** of the same engine; they do not duplicate the loop.

Diagram and flow: [`02-architecture.md`](../core/02-architecture.md).

---

## Execution model

- **Run**: one concrete execution; `history` append-only; `state` for snapshot when entering `waiting`.
- **States**: `running` ⇄ `waiting` → `completed`, or `failed`.
- **Loop**: parse LLM `Step` → `thought` / `action` / `wait` / `result`; iteration limits and validation.
- **Wait / resume**: persist run; `resume(runId, input)` reinjects and returns to `running`.
- **Hooks** at the boundary (SDK): `onThought`, `onAction`, `onObservation`, `onWait` (observability; loop semantics live **inside** the engine).

Detail: [`03-execution-model.md`](../core/03-execution-model.md).

---

## Internal protocol

- Every relevant exchange is a **typed message**: `thought`, `action`, `observation`, `wait`, `result`.
- **Invariants**: the LLM **does not execute** tools (only proposes `action`); side effects go through the engine; history **immutable** (append only); durable state **outside** volatile model context.
- Prompt to model: parseable **JSON** output (one `Step` per turn).

Detail: [`04-protocol.md`](../core/04-protocol.md). JSON shapes and `Step`: [`07-definition-syntax.md`](../core/07-definition-syntax.md).

---

## Adapters

- **MemoryAdapter**: `save` / `query` / `delete` / `getState` by logical type (`shortTerm`, `working`, `longTerm`, optional `vectorMemory`).
- **ToolAdapter**: `name`, `execute`, `validate?`; observation enters history.
- **Hooks vs adapters**: hooks observe; adapters are the **authorized** path for effects from a valid `action`.
- Multi-agent: **MessageBus** does not replace ToolRunner; usually materialized as tool (`send_message`) or service in `context`.

Detail: [`05-adapters.md`](../core/05-adapters.md).

---

## Engine MVP (minimum scope)

- One reference agent + **AgentExecution** with loop, **iteration limit**, validated LLM JSON output.
- Minimal MemoryAdapter (in-memory + optional persistent); ToolRunner with at least memory (`save_memory` / `get_memory` or equivalent).
- **running / waiting / completed / failed** states + **resume**.
- Basic hooks.
- **Out** of engine MVP: visual builder, mandatory distributed `Agent.define`, MCP as hard requirement, complex parallel multi-agent.
- **Upstash** (Redis/Vector) plus **BullMQ** (primary job queue) or **QStash** (alternative) for scheduled/async wakeups — **adapter implementations**; core loop unchanged.

Success criteria, risks, implementation order: [`06-mvp.md`](../core/06-mvp.md).

---

## Definitions (`define` / `load`)

- Conceptual order: `Tool.define` → `Skill.define` → `Agent.define` → `Agent.load` + `run` / `resume`.
- Agent: `systemPrompt`, `skills` / `tools` lists, `memoryConfig`, `llm`, etc. (canonical JSON + library API).
- **Step** discriminated by `type`: `thought`, `action` (tool + input), `wait` (reason), `result`.

Detail and TS reference types: [`07-definition-syntax.md`](../core/07-definition-syntax.md).

---

## Scope and security

- **Scopes**: global → **project** → **session** → **run** (multi-tenant isolation and store namespaces).
- Tool/skill resolution: project first, then global.
- **SecurityLayer**: authenticates/authorizes **before** the loop; attaches `SecurityContext`; engine checks permissions when loading agent and executing `action`.
- Control points: define, load, run/resume, tool execution, MessageBus, memory with correct prefixes.

Detail: [`08-scope-and-security.md`](../core/08-scope-and-security.md).

---

## Multi-agent

- One loop per agent; coordination via **async messages** (tool `send_message` + **MessageBus**).
- Request–reply pattern: correlation + `wait` on A + `resume` when B replies on the bus.
- Isolation by `projectId`; risks: deadlock, orphan messages, timeouts.

Detail: [`09-communication-multiagent.md`](../core/09-communication-multiagent.md).

---

## LLM Adapter, Context Builder, Skills

- **LLMAdapter**: contract `generate(LLMRequest) → LLMResponse`; stable errors (rate limit, timeout, etc.); optional JSON/streaming.
- **Context Builder**: recommended block order (system, working, long-term, short-term, tool catalog, history); **SecurityContext** filtering; token budget and truncation.
- **Skills**: higher-level capabilities that **shape context and tool allowlist**; LLM still emits only standard **`Step`**; optional skill `execute` is bounded (MVP suggestion: declarative/template).

[`10-llm-adapter.md`](../core/10-llm-adapter.md) · [`11-context-builder.md`](../core/11-context-builder.md) · [`12-skills.md`](../core/12-skills.md)

---

## Errors, abort, and `Step` recovery

- Terminal states: `completed`, `failed`; `waiting` is not an error.
- Taxonomy: LLM transport, rate limit, parsing, policy, tool, cancellation (`AbortSignal`).
- Timeouts: global run, per LLM iteration, per tool.
- **Bounded re-prompt** (typically 1 turn) if JSON/`Step` is invalid.

Detail: [`13-errors-parsing-and-recovery.md`](../core/13-errors-parsing-and-recovery.md).

---

## Engine consumers

| Consumer | Typical role |
|----------|----------------|
| **SDK** | In-app integration (`run`, `resume`, hooks). |
| **CLI** | Human operation and debugging (delegates to SDK). |
| **REST** | Remote clients, dashboards, BFF. |
| **MCP** | Interop channel with hosts that expose tools; **does not** replace the engine. |
| **Webhooks / cron** | Trigger `run` or `resume` with the same input contract. |

Detail: [`14-consumers.md`](../core/14-consumers.md).

---

## Quick index `docs/core`

| Doc | Topic |
|-----|-------|
| `01` | Purpose and layers |
| `02` | Components and responsibilities |
| `03` | Run, states, loop, wait/resume |
| `04` | Messages, envelope, rules |
| `05` | MemoryAdapter, ToolAdapter |
| `06` | MVP, risks, Upstash |
| `07` | JSON + `Tool/Skill/Agent.define`, `load`, `run` |
| `08` | Scope, SecurityLayer |
| `09` | MessageBus, `send_message` |
| `10` | LLMAdapter |
| `11` | Context Builder |
| `12` | Skills vs tools |
| `13` | Errors, parsing, re-prompt |
| `14` | Consumers |

Declared origin in core: derived and reorganized from `docs/brainstorm/` and the *Agentes AI* thread; this `09` returns the summarized view to the brainstorm for readers who start from the ideas folder.
