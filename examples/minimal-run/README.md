# Minimal run example

Single-file demo: **`new AgentRuntime({ … })`** with a **mock LLM** (no OpenAI key), **`InMemoryMemoryAdapter`**, **`Agent.define`** → **`Agent.load(..., runtime, …)`** → **`run()`**.

**Production:** replace **`InMemoryMemoryAdapter`** with **`RedisMemoryAdapter`** or **`UpstashRedisMemoryAdapter`** so memory is shared and durable — see [`examples/README.md`](../README.md#memory-in-production) and [`docs/core/19-cluster-deployment.md`](../../docs/core/19-cluster-deployment.md).

## Prerequisite

Build core once (the example imports `dist` from `@agent-runtime/core`):

```bash
# from repository root
pnpm turbo run build --filter=@agent-runtime/core
```

## Run

```bash
pnpm install
pnpm --filter @agent-runtime/example-minimal-run start
```

Or from this directory after `pnpm install` at the repo root:

```bash
pnpm start
```

## Next steps

- Swap **`DeterministicDemoLlm`** for **`OpenAILLMAdapter`** from `@agent-runtime/adapters-openai` and set `OPENAI_API_KEY`.
- Add **`runStore`** to **`AgentRuntime`** and exercise **`wait` / `resume`** — see [`docs/core/19-cluster-deployment.md`](../../docs/core/19-cluster-deployment.md).
- Scaffold a full project: `pnpm exec agent-runtime init my-app` (from a package that installs `@agent-runtime/cli`).
