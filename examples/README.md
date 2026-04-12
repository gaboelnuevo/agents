# Examples

Runnable sample programs under **`examples/*`**, linked as **`pnpm` workspace** packages (see root [`pnpm-workspace.yaml`](../pnpm-workspace.yaml)). From the repository root: `pnpm install`, build the workspace packages each example depends on, then `pnpm --filter <package> start` or `cd examples/<dir> && pnpm start`.

### Memory in production

Most examples use **`InMemoryMemoryAdapter`**: it is **in-process only** (heap), **not durable** across restarts, and **wrong for multiple workers** — each process has its own empty store.

For production or any shared runtime, swap to **`RedisMemoryAdapter`** (`@opencoreagents/adapters-redis`, TCP `REDIS_URL`) or **`UpstashRedisMemoryAdapter`** (`@opencoreagents/adapters-upstash`, HTTP), and pass that adapter into **`new AgentRuntime({ memoryAdapter: … })`**. Cluster guidance: [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md) §1.2; adapter inventory: [`docs/core/05-adapters.md`](../docs/core/05-adapters.md).

---

## Choosing an example (usage cases)

| If you want to… | Start here |
|-----------------|------------|
| See the **smallest** **`Agent.run()`** loop with a **mock LLM**, no network or keys | [`minimal-run/`](./minimal-run/) |
| Use **OpenAI** with **tools + skills** and **`Tool.define`** in a real provider setup | [`openai-tools-skill/`](./openai-tools-skill/) (needs **`OPENAI_API_KEY`**) |
| Learn **`wait`** and **continue in the same process** via **`RunBuilder.onWait`** (e.g. CLI) | [`console-wait/`](./console-wait/) |
| Learn **RAG only**: **catalog**, **`system_ingest_rag_source`**, **`system_vector_search`**, demo embeddings | [`rag/`](./rag/) |
| Combine **RAG** with a **custom tool**, **`Session.sessionContext`** (e.g. email), **`contact_support`**, and **`Agent.resume`** after **`wait`** (**`InMemoryRunStore`**) | [`rag-contact-support/`](./rag-contact-support/) |
| Wire **multi-agent** messaging: **`InProcessMessageBus`**, **`system_send_message`**, request/reply | [`multi-agent/`](./multi-agent/) |
| **Express** BFF + **browser UI** (`public/`): **`POST /v1/chat`**, **`POST /v1/chat/stream`** (SSE hooks), **`GET /status`**, run + session status, **`wait`** + **`resume`** (optional **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`**) | [`real-world-with-express/`](./real-world-with-express/) |
| **Redis** definitions + **BullMQ** worker + **per-job hydrate** (REST CRUD; API enqueues, worker runs engine) | [`dynamic-runtime-rest/`](./dynamic-runtime-rest/) |
| **Plan-shaped REST** after **`Agent.define`**: **`@opencoreagents/rest-api`** **`createRuntimeRestRouter`** — contract in **`docs/plan-rest.md`** (runs, history, memory, …), optional **`runStore`**, OpenAPI **`/openapi.json`** + **`/docs`** in the sample, fixed or multi-**`projectId`**, optional **`apiKey`** ([`packages/rest-api/README.md`](../packages/rest-api/README.md)) | [`plan-rest-express/`](./plan-rest-express/) · [`docs/plan-rest.md`](../docs/plan-rest.md) |
| **Custom BFF** (sync chat UI, SSE, your own routes): extend **`real-world-with-express`** or **`dynamic-runtime-rest`** (async BullMQ); see **`docs/plan-rest.md`** (*Pick a starting point*) | [`real-world-with-express/`](./real-world-with-express/) · [`dynamic-runtime-rest/`](./dynamic-runtime-rest/) · [`docs/plan-rest.md`](../docs/plan-rest.md) |
| **Telegram-shaped** webhook updates + **`ConversationGateway`**, **mock** outbound (no `api.telegram.org`) | [`telegram-example-mocked/`](./telegram-example-mocked/) |

**Notes**

- **`rag-contact-support`** runs **two** user turns (warranty-style KB question, then a refund/ticket scenario), uses a **scripted LLM** (no API keys), and is best run **interactively** in a terminal (see [rag-contact-support/README.md](./rag-contact-support/README.md)).
- For **`wait` + `resume`** across separate workers or processes, pair a **`RunStore`** (Redis, etc.) with the same **`Agent.resume(runId, …)`** pattern shown in that example; see [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md).
- **`real-world-with-express`** — **`GET /`** serves a small **HTML/JS** demo from **`public/`** (same-origin **`fetch`**). **`RunStore`**-backed **`GET`** endpoints show persisted state **after** each engine segment finishes (not step-by-step while **`executeRun`** is in flight); use **`POST /v1/chat/stream`** for live hook events. Concurrent **`POST /v1/chat`** calls are **not** queued per session (parallel runs, shared in-process memory). **`GET /health`** (minimal) and **`GET /status`** (process metadata) are outside **`API_KEY`**; **`/v1/*`** may require **`API_KEY`** when set. See [real-world-with-express/README.md](./real-world-with-express/README.md).

---

## Inventory (all examples)

| Package | Directory | Summary |
|---------|-----------|---------|
| `@opencoreagents/example-minimal-run` | [`minimal-run/`](./minimal-run/) | **`Agent.run()`** end-to-end with a **deterministic mock LLM** and **`InMemoryMemoryAdapter`**. No network, no API keys. |
| `@opencoreagents/example-openai-tools-skill` | [`openai-tools-skill/`](./openai-tools-skill/) | **`OpenAILLMAdapter`** (engine maps native `tool_calls` when `content` is empty), custom **`Tool.define`** (`roll_dice`), **`Skill.define`**, **`Agent.define`**. Requires **`OPENAI_API_KEY`**. |
| `@opencoreagents/example-console-wait` | [`console-wait/`](./console-wait/) | Interactive **terminal**: mock LLM emits **`wait`**, **`RunBuilder.onWait`** reads stdin (`readline`), then continues in-process. No API keys. |
| `@opencoreagents/example-rag` | [`rag/`](./rag/) | **`registerRagCatalog(runtime, …)`** (per project) + **`system_ingest_rag_source`** / **`system_vector_search`**; in-memory vector + hash embeddings (no API keys); optional OpenAI script. |
| `@opencoreagents/example-multi-agent` | [`multi-agent/`](./multi-agent/) | **`InProcessMessageBus`** + **`system_send_message`**: fire-and-forget **event**, then **request** / **reply** with **`correlationId`** (mock LLM; no keys). |
| `@opencoreagents/example-rag-contact-support` | [`rag-contact-support/`](./rag-contact-support/) | **RAG** + **`contact_support`**, **`Session.sessionContext`**, two CLI turns (KB vs ticket), **`wait`** + **`Agent.resume`** with **`InMemoryRunStore`** (scripted LLM; no keys). |
| `@opencoreagents/example-real-world-with-express` | [`real-world-with-express/`](./real-world-with-express/) | **Express** BFF + **`public/`** HTML/JS UI: JSON chat + **SSE**, **`GET /status`**, run + session status, wait/resume; **`API_KEY`**, CORS, **`X-Request-Id`**, SIGTERM shutdown; **`InMemoryRunStore`**; mock or **OpenAI** / **Anthropic**. |
| `@opencoreagents/example-dynamic-runtime-rest` | [`dynamic-runtime-rest/`](./dynamic-runtime-rest/) | **`RedisDynamicDefinitionsStore`** (`store.Agent`, `store.methods`), BullMQ **`POST /v1/run`**, **`GET /v1/jobs/:id`**. |
| `@opencoreagents/example-plan-rest-express` | [`plan-rest-express/`](./plan-rest-express/) | Minimal Express app: **`Agent.define`** + **`createRuntimeRestRouter`** (`@opencoreagents/rest-api`); routes per **`docs/plan-rest.md`**; mock LLM + **`InMemoryRunStore`**; **Swagger** at **`/docs`**. |
| `@opencoreagents/example-telegram-mocked` | [`telegram-example-mocked/`](./telegram-example-mocked/) | **Mock** Telegram **`Update`** / **`Message`** → **`NormalizedInboundMessage`** → **`ConversationGateway`** → **`MockTelegramClient`** outbox (no Telegram network or bot token). |

### `minimal-run` — `@opencoreagents/example-minimal-run`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core` |
| **Run** | `pnpm --filter @opencoreagents/example-minimal-run start` |
| **Docs** | [minimal-run/README.md](./minimal-run/README.md) |

### `openai-tools-skill` — `@opencoreagents/example-openai-tools-skill`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/adapters-openai` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Env** | `OPENAI_API_KEY` (required); optional `OPENAI_MODEL` (default `gpt-4o-mini`) |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/adapters-openai` |
| **Run** | `OPENAI_API_KEY=sk-... pnpm --filter @opencoreagents/example-openai-tools-skill start` |
| **Docs** | [openai-tools-skill/README.md](./openai-tools-skill/README.md), [openai-tools-skill/.env.example](./openai-tools-skill/.env.example) |

### `console-wait` — `@opencoreagents/example-console-wait`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core` |
| **Run** | `pnpm --filter @opencoreagents/example-console-wait start` (interactive); or pipe a line: `printf 'hello\\n' \| pnpm --filter @opencoreagents/example-console-wait start` |
| **Docs** | [console-wait/README.md](./console-wait/README.md) |

### `rag` — `@opencoreagents/example-rag`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/rag` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/rag` (add `--filter=@opencoreagents/adapters-openai` for `start:openai`) |
| **Run** | `pnpm --filter @opencoreagents/example-rag start` (no keys); optional `pnpm --filter @opencoreagents/example-rag run start:openai` + `OPENAI_API_KEY` |
| **Docs** | [rag/README.md](./rag/README.md) |

### `multi-agent` — `@opencoreagents/example-multi-agent`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core` |
| **Run** | `pnpm --filter @opencoreagents/example-multi-agent start` |
| **Docs** | [multi-agent/README.md](./multi-agent/README.md) |

### `rag-contact-support` — `@opencoreagents/example-rag-contact-support`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/rag` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/rag` |
| **Run** | `pnpm --filter @opencoreagents/example-rag-contact-support start` (**interactive** terminal recommended) |
| **Docs** | [rag-contact-support/README.md](./rag-contact-support/README.md) |

### `real-world-with-express` — `@opencoreagents/example-real-world-with-express`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/adapters-openai`, `@opencoreagents/adapters-anthropic`, `express`, `cors` |
| **Scripts** | `pnpm start` → `tsx src/server.ts`; `pnpm typecheck` |
| **Env** | Optional `OPENAI_*` / `ANTHROPIC_*`; optional `EXPRESS_LLM_PROVIDER` (`openai` \| `anthropic`); optional `PORT`; optional `API_KEY` (bearer for `/v1/*`, not `/health` or `/status`); optional `SHUTDOWN_TIMEOUT_MS` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/adapters-openai --filter=@opencoreagents/adapters-anthropic` |
| **Run** | `pnpm --filter @opencoreagents/example-real-world-with-express start` |
| **UI** | Static **`public/`** (`GET /`) — same-origin demo for **`/v1/*`** |
| **Endpoints (v1)** | `POST /chat`, `POST /chat/stream`, `GET /runs/:runId`, `GET /sessions/:sessionId/status`, `POST /runs/wait-demo`, `POST /runs/:runId/resume` |
| **Docs** | [real-world-with-express/README.md](./real-world-with-express/README.md), [real-world-with-express/.env.example](./real-world-with-express/.env.example) |

### `plan-rest-express` — `@opencoreagents/example-plan-rest-express`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/rest-api`, `express` |
| **Scripts** | `pnpm start` → `tsx src/server.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/rest-api` |
| **Run** | `pnpm --filter @opencoreagents/example-plan-rest-express start` |
| **Endpoints** | Plan contract: `GET /agents`, `POST …/run`, `POST …/resume`, `GET /runs/:runId`, `GET /runs/:runId/history`, `GET /agents/:agentId/runs`, `GET …/memory`, **`GET /openapi.json`**, **`GET /docs`** — full table [`docs/plan-rest.md`](../docs/plan-rest.md) |
| **Docs** | [plan-rest-express/README.md](./plan-rest-express/README.md), [`packages/rest-api/README.md`](../packages/rest-api/README.md) |

### `telegram-example-mocked` — `@opencoreagents/example-telegram-mocked`

| | |
|--|--|
| **Workspace deps** | `@opencoreagents/core`, `@opencoreagents/conversation-gateway` |
| **Scripts** | `pnpm start` → `tsx src/main.ts`; `pnpm typecheck` |
| **Build first** | `pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/conversation-gateway` |
| **Run** | `pnpm --filter @opencoreagents/example-telegram-mocked start` |
| **Docs** | [telegram-example-mocked/README.md](./telegram-example-mocked/README.md) |

---

## Backlog — ideas for more examples (TODO)

Prioritize by what you want to teach (operators vs integrators). None of these exist as packages yet unless listed in **Inventory** above.

### Engine loop & lifecycle

- [x] **`wait` + `resume` (same process)** — [`rag-contact-support/`](./rag-contact-support/) uses **`InMemoryRunStore`** and **`Agent.resume(runId, { type: "text", content })`** after **`wait`**. **HTTP resume** — [`real-world-with-express/`](./real-world-with-express/) (`POST …/resume`). A **second worker** resuming the same run ID with a shared **`RedisRunStore`** (or similar) remains a good follow-up; see [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md).
- [x] **`RunBuilder.onWait`** (in-process) — covered by [`console-wait/`](./console-wait/) (stdin).
- [ ] **Session expiry** — `Session({ expiresAtMs })` + **`SessionExpiredError`** on `run` / `resume` after expiry.
- [ ] **Hooks + `watchUsage`** — `onThought` / `onAction` logging; token totals and “wasted” tokens after failed parses.

### Adapters & infrastructure

- [ ] **TCP Redis** — `RedisMemoryAdapter` + **`RedisRunStore`** + optional **`RedisMessageBus`**; `REDIS_URL`; Docker Compose one-liner in README.
- [ ] **Upstash REST** — `UpstashRedisMemoryAdapter` / **`UpstashRunStore`** / **`UpstashRedisMessageBus`** when HTTP-only Redis is required.
- [x] **BullMQ worker** — [`dynamic-runtime-rest/`](./dynamic-runtime-rest/) (`createEngineWorker` + **`runtime.dispatch`** / **`dispatchEngineJob`** from **`core`**, enqueue from Express); see [`@opencoreagents/adapters-bullmq`](../packages/adapters-bullmq/).

### Tools, memory, RAG

- [ ] **Built-in memory tools** — `system_save_memory` / `system_get_memory` with **`InMemoryMemoryAdapter`** or Redis-backed memory; show scopes (`shortTerm` / `working` / `longTerm`).
- [x] **`@opencoreagents/rag`** — covered by [`rag/`](./rag/) (**`registerRagCatalog(runtime, projectId, sources)`**, catalog ingest tools, in-memory vector); swap embeddings/vector/OpenAI per [rag/README.md](./rag/README.md).
- [x] **RAG + custom escalation tool** — [`rag-contact-support/`](./rag-contact-support/) (`contact_support` + **`skills: ["rag", "contact-support-skill"]`**).
- [ ] **Vector tools only** — `system_vector_upsert` / `system_vector_search` with **`UpstashVectorAdapter`** or another **`VectorAdapter`** implementation.

### Multi-agent

- [x] **`InProcessMessageBus` + `system_send_message`** — [`multi-agent/`](./multi-agent/) (event + request/reply; see [`docs/core/09-communication-multiagent.md`](../docs/core/09-communication-multiagent.md)).

### Providers & UX

- [ ] **OpenAI + memory** — extend the OpenAI example with long-lived **`Session`** + `system_save_memory` / `system_get_memory` in the prompt loop.
- [ ] **Anthropic** — if/when an `@opencoreagents/adapters-anthropic` (or similar) exists; same protocol JSON in `content`.
- [x] **Streaming / SSE (hook events)** — [`real-world-with-express/`](./real-world-with-express/) **`POST /v1/chat/stream`** streams **`RunBuilder`** hooks (`step`, `observation`, `done`). Token streaming from the provider is separate — see [`docs/plan-rest.md`](../docs/plan-rest.md).

### Ops & testing

- [x] **Graceful HTTP shutdown** — [`real-world-with-express/`](./real-world-with-express/) closes the server on SIGINT/SIGTERM (in-flight HTTP handlers finish; long **`executeRun`** is not aborted — see example **`shutdown.ts`**). Workers/queues: [`docs/core/19-cluster-deployment.md`](../docs/core/19-cluster-deployment.md).
- [ ] **CI-friendly** — example that uses only mocks / Docker Redis service (no paid API), runnable in GitHub Actions as a smoke job.

---

## Adding another example

1. Create `examples/<name>/` with its own `package.json` (`"name": "@opencoreagents/example-<something>"`, `"private": true`, `"type": "module"`).
2. Add `"examples/*"` if missing in root `pnpm-workspace.yaml` (already present).
3. Depend on workspace packages with `"workspace:*"` (e.g. `@opencoreagents/core`).
4. Register it in this file under **Inventory** and add a short subsection like the ones above; remove or check off the matching item in **Backlog** when implemented.
