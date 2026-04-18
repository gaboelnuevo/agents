# `@opencoreagents/runtime` — documentation

| Doc | Topic |
|-----|--------|
| [docker.md](./docker.md) | Docker Compose (recommended local stack), image / Compose details |
| [why-redis.md](./why-redis.md) | Why Redis is required, sizing, production |
| [configuration.md](./configuration.md) | Stack YAML/JSON, templates, `loadStackRuntime`, `llm`, default model env (`RUNTIME_DEFAULT_LLM_MODEL`, …), scripts |
| [cli.md](./cli.md) | `config:print`, `config:env`, flags |
| [host.md](./host.md) | Node + pnpm on the host, optional Redis-only container |
| [cloud.md](./cloud.md) | Multi-replica / managed Redis / secrets |
| [security.md](./security.md) | API keys, `REST_API_KEY`, Redis hardening, HTTP tools |
| [chat-runs-and-planner.md](./chat-runs-and-planner.md) | No “chat” in core; **continue** (same `runId`), `sessionId`, non-blocking `invoke_planner` |

Repo overview: [../README.md](../README.md). Plan REST contract: [`docs/planning/plan-rest.md`](../../../docs/planning/plan-rest.md) (monorepo).
