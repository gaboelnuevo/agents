# Engine MVP and risks

## Minimum core scope

- One reference **Agent** with system prompt + closed tool list.
- **AgentExecution** with loop, **iteration limit**, validated LLM output as **JSON**.
- Minimal **MemoryAdapter**: in-memory + optional persistent adapter (`save` / `query` for long-term or working).
- **ToolRunner** with at least: `save_memory`, `get_memory` (or equivalent).
- States: **running**, **waiting**, **completed**, **failed** + **resume** after `wait`.
- Basic **hooks** at the run boundary (thought / action / observation / wait).

## Upstash adapters in MVP

Part of the **deployment MVP** (edge/serverless): **serverless** persistence and triggers without self-hosted Redis/vector. Implement as **adapters** that satisfy the same core interfaces ([05-adapters.md](./05-adapters.md)); the engine loop does not change.

| Adapter / tool | MVP role |
|----------------|----------|
| **Upstash Redis → MemoryAdapter** | `longTerm` and/or working keyed by `agentId`, `sessionId`; optional TTL per session. Replaces or complements file/Mongo adapter for first edge deployment. |
| **BullMQ on Redis (primary for jobs)** | **First implementation** for async `run` / `resume`, delayed jobs after `wait` (`reason: scheduled`), and optional **MessageBus** backend. Workers call the same engine API as SDK/REST — [05-adapters.md](./05-adapters.md#job-queue-adapter-primary-bullmq). |
| **Upstash QStash (alternative)** | If you skip BullMQ workers: HTTP callback to `POST /runs/:id/resume` (or internal equivalent) after a delay — serverless-friendly; **secondary** to BullMQ for the same semantics. |
| **Upstash Vector (optional MVP+)** | Tool `vector_search` / `vector_upsert` or subset: embeddings + query for semantic memory; can ship in the same phase as MVP if the use case requires it. |

Criteria to count them “inside MVP”:

- **Minimum viable cloud**: Redis adapter + same `save_memory` / `get_memory` tools backed by Upstash.
- **No core coupling**: credentials and keyspace prefixes only in the adapter factory, not in `AgentExecution`.

## Out of engine MVP

- Visual builder.
- Dynamic `Agent.define` in a distributed store (can come later).
- MCP as a hard requirement.
- Complex semantic vector without real need (if you do not use Upstash Vector in MVP+).
- Complex multi-agent parallelism.

## Success criteria

- The agent **remembers** across executions with a local adapter **or** Upstash Redis.
- A run can **pause** (`wait`) and **continue** with new input.
- Tools run only after a **validated action** from the engine.
- Same behavior whether the caller is **SDK** or **HTTP** (same internal API).

## Risks and mitigation

| Risk | Mitigation |
|------|------------|
| Long or infinite loops | `maxIterations`, global run timeout. |
| Malformed or hallucinated JSON | Strict schema/parser; bounded correction retries. |
| Inconsistent state | Snapshot per `runId` when entering `waiting`; do not mutate history. |
| Dangerous tools | Allowlist, per-tool validation, sandbox or network limits. |
| Shared Redis / Upstash limits | Namespaces by `projectId`/`agentId`, TTL, rate limits, payload size in memory. |

## Suggested implementation order

Detailed contracts: [10-llm-adapter.md](./10-llm-adapter.md), [11-context-builder.md](./11-context-builder.md), [12-skills.md](./12-skills.md), [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

1. LLM Adapter + parsing a single step type (`result` or `action`).
2. ToolRunner + minimal memory (in-memory or file).
3. Full loop + `wait` / `resume`.
4. **Upstash Redis MemoryAdapter** (same interface; key idempotency tests).
5. Hooks + hardening (timeouts, limits).
6. **BullMQ** workers for background `run` / `resume` and scheduled `wait` (or **QStash** only if you explicitly choose the HTTP-callback path).
7. (Optional MVP+) Vector search/upsert.
