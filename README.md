# agent-runtime (monorepo)

Stateful agent **engine** for Node.js: typed loop (`thought` → `action` → `observation` → `result` / `wait` / `resume`), pluggable adapters, RAG tools, multi-agent messaging, CLI/scaffold.

## Packages

| Package | Role |
|---------|------|
| `@agent-runtime/core` | Engine, `Tool` / `Skill` / `Agent`, `RunBuilder`, `executeRun`, built-in tools |
| `@agent-runtime/adapters-openai` | OpenAI LLM + embeddings |
| `@agent-runtime/adapters-redis` | TCP Redis: memory, `RunStore`, `MessageBus` |
| `@agent-runtime/adapters-upstash` | Upstash REST Redis + vector |
| `@agent-runtime/adapters-bullmq` | **BullMQ** queue/worker + `dispatchEngineJob` |
| `@agent-runtime/utils` | Parsers, chunking, file resolver |
| `@agent-runtime/rag` | File/RAG tools + skills |
| `@agent-runtime/scaffold` | Programmatic project generation |
| `@agent-runtime/cli` | `agent-runtime` CLI |

## Docs

- **Product / overview:** [`docs/README.md`](docs/README.md)
- **Engine reference:** [`docs/core/README.md`](docs/core/README.md)
- **Implementation plan:** [`docs/plan.md`](docs/plan.md)
- **Monorepo layout & types:** [`docs/scaffold.md`](docs/scaffold.md)

## Develop

```bash
pnpm install
pnpm turbo run build test lint
```

CI runs the same via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

Private / TBD — see repository settings.
