# OpenCore Agents

TypeScript monorepo for production-shaped agent backends.

OpenCore Agents helps teams ship agent APIs and workers they can own in production, not demo scripts that collapse on timeouts or process restarts.

Use the OpenClaw skill ecosystem you already know, but run it your way. `@opencoreagents/runtime` gives you control to build, customize, and scale assistants without depending on the OpenClaw Gateway.

Stop hand-rolling the same glue:

- Typed execution loop (`thought` -> `action` -> `observation` -> `result`) with `wait`/`resume`
- Autonomous planning primitives (`invoke_planner`, `wait_for_agents`, sub-agent spawn patterns)
- Tools, skills, and RAG support
- Shared memory and run state patterns
- BullMQ worker execution
- Optional dynamic definitions in Redis (update prompts/tools without redeploying workers)

Plug in OpenAI, Anthropic, Redis, Upstash, Express. Explicit wiring, no hidden global singleton.

Apache License 2.0: use it in commercial products without copyleft constraints.

## Easy getting started (runnable stack)

To try the REST API contract against a real Redis + API + BullMQ worker without wiring packages manually, use the reference app in `apps/runtime`.

The runnable stack includes a dynamic planner path: default orchestrator agent seed, background planner invocation, optional SSE notifications, and continuous run follow-up (`/agents/:agentId/continue` with same `runId`).

1. Install [Docker](https://docs.docker.com/get-docker/).
2. Configure stack YAML:
`cp apps/runtime/config/docker.stack.example.yaml apps/runtime/config/docker.stack.yaml`
3. From repo root:
`docker compose -f apps/runtime/docker-compose-with-redis.yml up --build`
4. Verify:
[http://localhost:3010/health](http://localhost:3010/health)

Optional checks after boot:

- [http://localhost:3010/docs](http://localhost:3010/docs) for OpenAPI
- [http://localhost:3010/ui](http://localhost:3010/ui) for interactive playground

Full runtime guides: [apps/runtime/README](apps/runtime/README.md), [apps/runtime/docs](apps/runtime/docs/README.md).

## What you ship faster

- Real execution lifecycle: long runs, human-in-the-loop, `wait`/`resume`, step observers
- SaaS-friendly architecture: API layer + async workers
- Autonomous orchestration: background planning jobs, planner tool invocation, and sub-agent patterns
- Configurable B2B agents: Redis-backed definitions hydrated per job
- Replaceable infrastructure: adapters for LLM, memory, queues, vectors, gateways

## What teams build with it

| You are building | What here helps |
|---|---|
| B2B multi-tenant configurable agents | Redis definitions (`RedisDynamicDefinitionsStore`) + per-job hydration for no-redeploy prompt/tool updates. See [dynamic runtime example](examples/dynamic-runtime-rest/) and [dynamic runtime reference](docs/reference/core/21-dynamic-runtime-rest.md). |
| HTTP API + workers | `@opencoreagents/rest-api` + `dispatchEngineJob` / `AgentRuntime.dispatch` + BullMQ. See [plan REST example](examples/plan-rest-express/), [full Redis+worker example](examples/dynamic-runtime-rest/), and [REST plan](docs/roadmap/plan-rest.md). |
| Autonomous planning agents | Dynamic planner tools + `invoke_planner` to enqueue planning runs in background, with optional stream notifications and run continuation. See [runtime app README](apps/runtime/README.md) and [runs/planner guide](apps/runtime/docs/chat-runs-and-planner.md). |
| Support copilots / internal assistants | RAG + HTTP tools + `wait`/`resume`. See [RAG contact support](examples/rag-contact-support/) and [real-world express](examples/real-world-with-express/). |
| Multi-agent / gateway flows | Message bus + conversation gateway. See [multi-agent](examples/multi-agent/) and [telegram mocked gateway](examples/telegram-example-mocked/). |

If you only need a single `chat.completions` call without tools, memory, or background jobs, a vendor SDK is usually enough.

## Library, not a hosted product

You keep auth, tenant isolation, billing, and your data plane.

This repo gives you runtime primitives and integration patterns so you do not rebuild loops, dispatch, and dynamic registration from scratch.

Before customer traffic, read:

- [technical debt hub](docs/roadmap/technical-debt.md)
- [security and production debt](docs/roadmap/technical-debt-security-production.md)
- [scope and security reference](docs/reference/core/11-scope-and-security.md)

## How it works

Define tools, skills, and agents in code (or hydrate from a store).

Create one `AgentRuntime` per process/worker, then `Agent.load(id, runtime, { session })` and `run()`.

Use `RunStore` for cross-process resume and BullMQ workers for async execution (`dispatchEngineJob` / `runtime.dispatch`).

For autonomous orchestration, the runtime stack can delegate planning to background runs and continue the same conversation thread with `continue` semantics on the same `runId`.

### Promise-style runtime API (observers, wait, and scale)

`agent.run(input)` returns a `RunBuilder` that feels like promise-style composition:

- Chain lifecycle observers (`onThought`, `onAction`, `onObservation`, `onWait`)
- Keep local, interactive flows simple
- Resolve to a final `Run` with full history for audit/debug

```typescript
// `agent` = await Agent.load(..., runtime, { session })
await agent
  .run("Ticket #4412: refund still pending after 5 business days — what should we do next?")
  .onThought((t) => console.debug("[thought]", t.content))
  .onAction((a) => console.debug("[action]", a.tool, a.input))
  .onObservation((o) => console.debug("[observation]", o))
  .onWait(async (w) => {
    // Return a string to continue in-process; return undefined to keep status = waiting
    if (w.reason === "user_input") {
      return prompt((w.details as { question?: string })?.question ?? "");
    }
  })
  .then((run) => {
    const ended = run.history.find((h) => h.type === "result");
    console.log("[result]", ended?.content);
  });
```

Same developer ergonomics, different deployment shape: keep this API for local flows, then move the long-running path to `RunStore` + BullMQ workers when you need cross-process durability.

Minimal example with OpenAI adapter:

```typescript
import { OpenAILLMAdapter } from "@opencoreagents/adapters-openai";
import { Agent, AgentRuntime, Session, InMemoryMemoryAdapter } from "@opencoreagents/core";

const runtime = new AgentRuntime({
  llmAdapter: new OpenAILLMAdapter(process.env.OPENAI_API_KEY!),
  memoryAdapter: new InMemoryMemoryAdapter(),
});

await Agent.define({
  id: "greeter",
  projectId: "demo",
  systemPrompt: "You are helpful.",
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

const agent = await Agent.load("greeter", runtime, {
  session: new Session({ id: "s1", projectId: "demo" }),
});

const run = await agent.run("Say hello.");
console.log(run.status, run.history);
```

For production memory/scale details, use:

- [cluster deployment reference](docs/reference/core/16-cluster-deployment.md)
- [adapters contracts](docs/reference/core/05-adapters-contracts.md)
- [adapters infrastructure](docs/reference/core/13-adapters-infrastructure.md)

## Packages (high level)

| Area | Packages |
|---|---|
| Engine | [`@opencoreagents/core`](packages/core/README.md) |
| LLM adapters | [`@opencoreagents/adapters-openai`](packages/adapters-openai/README.md), [`@opencoreagents/adapters-anthropic`](packages/adapters-anthropic/README.md) |
| Redis and queues | [`@opencoreagents/adapters-redis`](packages/adapters-redis/README.md), [`@opencoreagents/adapters-upstash`](packages/adapters-upstash/README.md), [`@opencoreagents/adapters-bullmq`](packages/adapters-bullmq/README.md) |
| REST and HTTP tools | [`@opencoreagents/rest-api`](packages/rest-api/README.md), [`@opencoreagents/adapters-http-tool`](packages/adapters-http-tool/README.md), [`@opencoreagents/conversation-gateway`](packages/conversation-gateway/README.md) |
| Dynamic definitions and RAG | [`@opencoreagents/dynamic-definitions`](packages/dynamic-definitions/README.md), [`@opencoreagents/rag`](packages/rag/README.md), [`@opencoreagents/utils`](packages/utils/README.md) |
| CLI and scaffold | [`@opencoreagents/cli`](packages/cli/README.md), [`@opencoreagents/scaffold`](packages/scaffold/README.md) |
| Assistant skills | [`@opencoreagents/code-skills`](packages/code-skills/README.md), [`@opencoreagents/skill-loader-openclaw`](packages/skill-loader-openclaw/README.md) |

## Examples

Start here: [examples index](examples/README.md).

Recommended first steps:

1. [minimal-run](examples/minimal-run/)
2. [plan-rest-express](examples/plan-rest-express/)
3. [dynamic-runtime-rest](examples/dynamic-runtime-rest/)
4. [real-world-with-express](examples/real-world-with-express/)

## Documentation

Main hub: [docs/README](docs/README.md)

- Onboarding: [guides](docs/guides/README.md), [getting started](docs/getting-started.md)
- Contracts and behavior: [reference](docs/reference/README.md)
- Engine deep dive: [core reference index](docs/reference/core/README.md)
- Plans and known gaps: [roadmap](docs/roadmap/README.md)
- Historical context: [archive](docs/archive/README.md)

## Coding assistant skill packs

Package: [@opencoreagents/code-skills](packages/code-skills/README.md)

Common commands:

```bash
npx @opencoreagents/code-skills list
npx @opencoreagents/code-skills add opencoreagents-engine
```

## Develop

```bash
pnpm install
pnpm turbo run build test lint
```

## GitHub Packages

Publishing is maintainers-only via [publish workflow](.github/workflows/publish.yml).

## License

Apache License 2.0. See [LICENSE](LICENSE).
