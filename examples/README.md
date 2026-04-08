# Examples

Runnable sample programs under **`examples/*`**, linked as **`pnpm` workspace** packages (see root [`pnpm-workspace.yaml`](../pnpm-workspace.yaml)). From the repository root: `pnpm install`, build the workspace packages each example depends on, then `pnpm --filter <package> start` or `cd examples/<dir> && pnpm start`.

### Memory in production

Most examples use **`InMemoryMemoryAdapter`**: it is **in-process only** (heap), **not durable** across restarts, and **wrong for multiple workers** — each process has its own empty store.

For production or any shared runtime, swap to **`RedisMemoryAdapter`** (`@agent-runtime/adapters-redis`, TCP `REDIS_URL`) or **`UpstashRedisMemoryAdapter`** (`@agent-runtime/adapters-upstash`, HTTP), and pass that adapter into **`new AgentRuntime({ memoryAdapter: … })`**. Cluster guidance: [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md) §1.2; adapter inventory: [`docs/core/05-adapters.md`](../docs/core/05-adapters.md).

---

## Inventory (all examples)

| Package | Directory | Summary |
|---------|-----------|---------|
| `@agent-runtime/example-minimal-run` | [`minimal-run/`](./minimal-run/) | **`Agent.run()`** end-to-end with a **deterministic mock LLM** and **`InMemoryMemoryAdapter`**. No network, no API keys. |
| `@agent-runtime/example-openai-tools-skill` | [`openai-tools-skill/`](./openai-tools-skill/) | **`OpenAILLMAdapter`** (engine maps native `tool_calls` when `content` is empty), custom **`Tool.define`** (`roll_dice`), **`Skill.define`**, **`Agent.define`**. Requires **`OPENAI_API_KEY`**. |
| `@agent-runtime/example-console-wait` | [`console-wait/`](./console-wait/) | Interactive **terminal**: mock LLM emits **`wait`**, **`RunBuilder.onWait`** reads stdin (`readline`), then continues in-process. No API keys. |
| `@agent-runtime/example-rag` | [`rag/`](./rag/) | **`registerRagCatalog(runtime, …)`** (per project) + **`ingest_rag_source`** / **`vector_search`**; in-memory vector + hash embeddings (no API keys); optional OpenAI script. |

### `minimal-run` — `@agent-runtime/example-minimal-run`

| | |
|--|--|
| **Workspace deps** | `@agent-runtime/core` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@agent-runtime/core` |
| **Run** | `pnpm --filter @agent-runtime/example-minimal-run start` |
| **Docs** | [minimal-run/README.md](./minimal-run/README.md) |

### `openai-tools-skill` — `@agent-runtime/example-openai-tools-skill`

| | |
|--|--|
| **Workspace deps** | `@agent-runtime/core`, `@agent-runtime/adapters-openai` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Env** | `OPENAI_API_KEY` (required); optional `OPENAI_MODEL` (default `gpt-4o-mini`) |
| **Build first** | `pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/adapters-openai` |
| **Run** | `OPENAI_API_KEY=sk-... pnpm --filter @agent-runtime/example-openai-tools-skill start` |
| **Docs** | [openai-tools-skill/README.md](./openai-tools-skill/README.md), [openai-tools-skill/.env.example](./openai-tools-skill/.env.example) |

### `console-wait` — `@agent-runtime/example-console-wait`

| | |
|--|--|
| **Workspace deps** | `@agent-runtime/core` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@agent-runtime/core` |
| **Run** | `pnpm --filter @agent-runtime/example-console-wait start` (interactive); or pipe a line: `printf 'hello\\n' \| pnpm --filter @agent-runtime/example-console-wait start` |
| **Docs** | [console-wait/README.md](./console-wait/README.md) |

### `rag` — `@agent-runtime/example-rag`

| | |
|--|--|
| **Workspace deps** | `@agent-runtime/core`, `@agent-runtime/rag` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/rag` (add `--filter=@agent-runtime/adapters-openai` for `start:openai`) |
| **Run** | `pnpm --filter @agent-runtime/example-rag start` (no keys); optional `pnpm --filter @agent-runtime/example-rag run start:openai` + `OPENAI_API_KEY` |
| **Docs** | [rag/README.md](./rag/README.md) |

---

## Backlog — ideas for more examples (TODO)

Prioritize by what you want to teach (operators vs integrators). None of these exist as packages yet unless listed in **Inventory** above.

### Engine loop & lifecycle

- [ ] **`wait` + `resume`** — `Run` pauses with `wait`; **`AgentRuntime`** with **`runStore`** (`InMemoryRunStore` or **`RedisRunStore`**); second process or same script calls `Agent.resume` (see [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md)).
- [x] **`RunBuilder.onWait`** (in-process) — covered by [`console-wait/`](./console-wait/) (stdin). **`runStore` + `resume`** across workers remains in the item above.
- [ ] **Session expiry** — `Session({ expiresAtMs })` + **`SessionExpiredError`** on `run` / `resume` after expiry.
- [ ] **Hooks + `watchUsage`** — `onThought` / `onAction` logging; token totals and “wasted” tokens after failed parses.

### Adapters & infrastructure

- [ ] **TCP Redis** — `RedisMemoryAdapter` + **`RedisRunStore`** + optional **`RedisMessageBus`**; `REDIS_URL`; Docker Compose one-liner in README.
- [ ] **Upstash REST** — `UpstashRedisMemoryAdapter` / **`UpstashRunStore`** / **`UpstashRedisMessageBus`** when HTTP-only Redis is required.
- [ ] **BullMQ worker** — `createEngineWorker` + **`dispatchEngineJob`**; enqueue `run` or `resume` from a tiny script; Redis required (align with [`@agent-runtime/adapters-bullmq`](../packages/adapters-bullmq/)).

### Tools, memory, RAG

- [ ] **Built-in memory tools** — `save_memory` / `get_memory` with **`InMemoryMemoryAdapter`** or Redis-backed memory; show scopes (`shortTerm` / `working` / `longTerm`).
- [x] **`@agent-runtime/rag`** — covered by [`rag/`](./rag/) (**`registerRagCatalog(runtime, projectId, sources)`**, catalog ingest tools, in-memory vector); swap embeddings/vector/OpenAI per [rag/README.md](./rag/README.md).
- [ ] **Vector tools only** — `vector_upsert` / `vector_search` with **`UpstashVectorAdapter`** or another **`VectorAdapter`** implementation.

### Multi-agent

- [ ] **`InProcessMessageBus` + `send_message`** — two agents in one process; agent A requests something from B; correlate with **`correlationId`** (see [`docs/core/09-communication-multiagent.md`](../docs/core/09-communication-multiagent.md)).

### Providers & UX

- [ ] **OpenAI + memory** — extend the OpenAI example with long-lived **`Session`** + `save_memory` / `get_memory` in the prompt loop.
- [ ] **Anthropic** — if/when an `@agent-runtime/adapters-anthropic` (or similar) exists; same protocol JSON in `content`.
- [ ] **Streaming / SSE** — optional: demo HTTP server that streams hook events (product code; not in `core` today — see [`docs/plan-rest.md`](../docs/plan-rest.md)).

### Ops & testing

- [ ] **Graceful shutdown** — worker handles SIGTERM; finish in-flight `executeRun` (pattern in cluster docs).
- [ ] **CI-friendly** — example that uses only mocks / Docker Redis service (no paid API), runnable in GitHub Actions as a smoke job.

---

## Adding another example

1. Create `examples/<name>/` with its own `package.json` (`"name": "@agent-runtime/example-<something>"`, `"private": true`, `"type": "module"`).
2. Add `"examples/*"` if missing in root `pnpm-workspace.yaml` (already present).
3. Depend on workspace packages with `"workspace:*"` (e.g. `@agent-runtime/core`).
4. Register it in this file under **Inventory** and add a short subsection like the ones above; remove or check off the matching item in **Backlog** when implemented.
