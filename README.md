# OpenCore Agents

TypeScript **monorepo**: **`@opencoreagents/*`** in **`packages/`**, consumed via **`pnpm` workspaces** from a clone. **Not** on public npm yet.

**Production-shaped agent backends in TypeScript**—so you ship **APIs and workers** your team can own, not a demo script that dies on the first timeout.

**Using Cursor, Claude Code, Codex, or similar?** Point them at **[`@opencoreagents/code-skills`](packages/code-skills/README.md)** (`SKILL.md` packs for this repo’s engine, REST/RAG, and layout)—see [Coding assistant skill packs](#coding-assistant-skill-packs) and the [table below](#assistant-skills-cursor--claude--codex).

Stop hand-rolling the same glue: a **typed agent loop** (`thought` → `action` → `observation` → `result`, plus **`wait` / `resume`**), **tools and RAG**, **shared memory and run state**, and **BullMQ** execution.

There is also an optional path where **prompts and tool configs live in Redis** and update **without redeploying workers**. Plug in OpenAI, Anthropic, Redis, Upstash, Express—**no global singleton** hiding who runs what.

*Apache License 2.0 — use and ship it in commercial products without copyleft baggage.*

---

## Contents

- [What you ship faster](#what-you-ship-faster)
- [What teams build with it](#what-teams-build-with-it)
- [Under the hood](#under-the-hood)
- [Library, not a hosted product](#library-not-a-hosted-product)
- [How it works](#how-it-works)
- [Packages](#packages)
- [Examples](#examples)
- [Docs](#docs) (includes [Planning](#planning) and [coding assistant skill packs](#coding-assistant-skill-packs))
- [Develop](#develop)
- [License](#license)

---

## What you ship faster

- **A real execution model** — long runs, human-in-the-loop, resume across processes when you add a **`RunStore`**; observe every step with **`RunBuilder`** hooks.

- **A SaaS-friendly split** — HTTP surface (**`@opencoreagents/rest-api`**) plus **queue workers**; the API stays responsive while **`dispatchEngineJob` / `runtime.dispatch`** does the heavy lifting.

- **Configurable agents for B2B** — definitions in **`RedisDynamicDefinitionsStore`**; workers **hydrate per job** so each tenant’s prompts and HTTP tools can change on the next job ([`examples/dynamic-runtime-rest`](examples/dynamic-runtime-rest/)).

- **Batteries you can swap** — `LLMAdapter`, `MemoryAdapter`, vectors, gateways: keep what fits your stack, replace what does not.

---

## What teams build with it

| You are building… | What here helps |
|-------------------|-----------------|
| **B2B / multi-tenant “configurable agents”** | Store **agents, skills, and HTTP tool JSON** in Redis (`RedisDynamicDefinitionsStore`); workers **hydrate per job** so prompt/tool changes apply **without redeploy**.<br><br>Walkthrough: [`examples/dynamic-runtime-rest`](examples/dynamic-runtime-rest/) · [`docs/core/21-dynamic-runtime-rest.md`](docs/core/21-dynamic-runtime-rest.md) |
| **HTTP API + workers (classic SaaS shape)** | **`@opencoreagents/rest-api`** for plan-shaped routes; **`dispatchEngineJob`** / **`AgentRuntime.dispatch`** for **BullMQ**—enqueue from the API, execute in workers.<br><br>Minimal REST-only: [`examples/plan-rest-express`](examples/plan-rest-express/). Full stack (Redis + queue): [`examples/dynamic-runtime-rest`](examples/dynamic-runtime-rest/). [`docs/planning/plan-rest.md`](docs/planning/plan-rest.md) |
| **Support or internal copilots** | **RAG** packages + **HTTP tools** to reach tickets/CRMs; **`wait` / `resume`** when the agent needs human input.<br><br>[`examples/rag-contact-support`](examples/rag-contact-support/) · [`examples/real-world-with-express`](examples/real-world-with-express/) |
| **Multi-agent or gateway flows** | In-process **message bus**, **`@opencoreagents/conversation-gateway`** for normalized inbound events (e.g. messaging webhooks).<br><br>[`examples/multi-agent`](examples/multi-agent/) · [`examples/telegram-example-mocked`](examples/telegram-example-mocked/) (mock Telegram → gateway, no real Bot API) |

**Skip this repo** if you only need a single `chat.completions` call with no tools, session memory, or background jobs—the vendor SDK is enough.

---

## Under the hood

Stateful **engine**: protocol loop, pluggable adapters (LLM, memory, vector, queues), RAG and multi-agent helpers, CLI/scaffold.

Sixteen **`@opencoreagents/*`** packages in **`packages/`** (see [Packages](#packages) below). Registry releases, when used, are **maintainer-only**: [GitHub Packages](#github-packages).

---

## Library, not a hosted product

You keep **auth, tenant isolation, billing, and your data plane**.

This codebase gives you the **agent runtime and integration patterns** so you are not rebuilding loops, job dispatch, and dynamic registration from scratch.

Before customer traffic, read [**`docs/planning/technical-debt.md`**](docs/planning/technical-debt.md) (start with [**`technical-debt-security-production.md`**](docs/planning/technical-debt-security-production.md) for tenancy and HTTP gaps) and [**`docs/core/08-scope-and-security.md`**](docs/core/08-scope-and-security.md).

Demos use permissive defaults (mock LLM, in-memory stores) on purpose—**swap them for Redis, real LLMs, and strict keys** in your deployment.

---

## How it works

Define **tools**, **skills**, and **agents** in code (or hydrate from a store).

Create one **`AgentRuntime`** per process/worker, then **`Agent.load(id, runtime, { session })`** and **`run()`**.

The engine runs the loop, memory scopes, optional **`RunStore`** for cluster **`resume`**, and **`dispatchEngineJob(runtime, payload)`** (**`@opencoreagents/core`**, also on **`@opencoreagents/adapters-bullmq`**) for workers—**explicit wiring**, no hidden global executor.

### Minimal example (OpenAI)

Requires **`OPENAI_API_KEY`**.

**`OpenAILLMAdapter`** is the real **`LLMAdapter`** for Chat Completions. For **keyless** mock-LLM walkthroughs, see [`examples/minimal-run`](examples/minimal-run/) (smallest loop) and [`examples/load-openclaw-skills`](examples/load-openclaw-skills/) (**`SKILL.md`** packs + **`exec`** via **`skill-loader-openclaw`**).

**`InMemoryMemoryAdapter`** keeps session memory **inside the Node process** only—fine for tests and single-process demos; it is **not** shared across workers or restarts.

```typescript
import { OpenAILLMAdapter } from "@opencoreagents/adapters-openai";
import { Agent, AgentRuntime, Session, InMemoryMemoryAdapter } from "@opencoreagents/core";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY");

const runtime = new AgentRuntime({
  llmAdapter: new OpenAILLMAdapter(apiKey),
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

### LLM and memory adapters

**Other LLM providers:** swap **`OpenAILLMAdapter`** for **`AnthropicLLMAdapter`** from **`@opencoreagents/adapters-anthropic`**, or implement **`LLMAdapter`** yourself (see mocks in [`examples/minimal-run`](examples/minimal-run/) and [`examples/load-openclaw-skills`](examples/load-openclaw-skills/)).

**Memory — in-process vs Redis:** keep **`InMemoryMemoryAdapter`** when a single process owns the whole run and you do not need durability or sharing.

For **multiple API instances or queue workers** (or memory that survives process restarts), use **`RedisMemoryAdapter`** from **`@opencoreagents/adapters-redis`** (TCP Redis) or **`UpstashRedisMemoryAdapter`** from **`@opencoreagents/adapters-upstash`** so every worker sees the same scoped memory for a given session.

### Observers, `wait`, and scaling out

**`agent.run(input)`** returns a **`RunBuilder`**: chain observers, then resolve to a **`Run`** (inspect **`run.history`** for the final **`result`** message).

```typescript
// `agent` = await Agent.load(..., runtime, { session }) as above
await agent
  .run("Ticket #4412: refund still pending after 5 business days — what should we do next?")
  .onThought((t) => console.debug("[thought]", t.content))
  .onAction((a) => console.debug("[action]", a.tool, a.input))
  .onObservation((o) => console.debug("[observation]", o))
  .onWait(async (w) => {
    // Agent paused — return a string to continue in-process, or `undefined` to stay `waiting`
    if (w.reason === "user_input") {
      return prompt((w.details as { question?: string })?.question ?? "");
    }
  })
  .then((run) => {
    const ended = run.history.find((h) => h.type === "result");
    console.log("[result]", ended?.content);
  });
```

When you move past a single process, add **`RedisMemoryAdapter`** / **`RedisRunStore`** as needed and **`@opencoreagents/adapters-bullmq`** so **`dispatchEngineJob`** runs work off the HTTP request path.

### REST API (`@opencoreagents/rest-api`)

Mount **`createRuntimeRestRouter`** after **`Agent.define`** and **`AgentRuntime`** so HTTP clients use the plan-shaped JSON routes (`GET /agents`, `POST /agents/:id/run`, run history, optional Swagger).

Runnable demo: [`examples/plan-rest-express`](examples/plan-rest-express/). Route contract: [`docs/planning/plan-rest.md`](docs/planning/plan-rest.md).

```typescript
import express from "express";
import { createRuntimeRestRouter } from "@opencoreagents/rest-api";

const app = express();
app.use(
  createRuntimeRestRouter({
    runtime,
    projectId: "my-project",
    runStore, // e.g. InMemoryRunStore or RedisRunStore
    resolveApiKey: () => process.env.REST_API_KEY?.trim() || undefined,
  }),
);
app.listen(3050);
```

### Dynamic definitions (Redis + worker)

Put **agents / skills / HTTP tools** in **`RedisDynamicDefinitionsStore`**.

On the worker, set **`dynamicDefinitionsStore`** (and optional **`dynamicDefinitionsSecrets`**) on **`AgentRuntime`** so **`runtime.dispatch(job.data)`** (or **`dispatchEngineJob`**) **hydrates from Redis per job**—edits in Redis apply on the next job without redeploying workers.

End-to-end sample: [`examples/dynamic-runtime-rest`](examples/dynamic-runtime-rest/). Deep dive: [`docs/core/21-dynamic-runtime-rest.md`](docs/core/21-dynamic-runtime-rest.md).

```typescript
import { createEngineWorker } from "@opencoreagents/adapters-bullmq";
import { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import { AgentRuntime } from "@opencoreagents/core";

const store = new RedisDynamicDefinitionsStore(redis, { keyPrefix: "myapp:defs" });
const runtime = new AgentRuntime({
  llmAdapter,
  memoryAdapter,
  dynamicDefinitionsStore: store,
  // Optional: resolve {{secret:*}} in HTTP tool templates during hydration
  dynamicDefinitionsSecrets: () => ({ api_token: process.env.DOWNSTREAM_API_TOKEN ?? "" }),
});

createEngineWorker("engine", workerRedisConnection, async (job) => runtime.dispatch(job.data));
```

Your **HTTP control plane** (Express or any framework) typically **writes definitions** through the store facade and **enqueues** run/resume jobs—see [`examples/dynamic-runtime-rest/src/api.ts`](examples/dynamic-runtime-rest/src/api.ts).

---

## Packages

### Core engine

| Package | Role |
|---------|------|
| [`@opencoreagents/core`](packages/core/README.md) | Engine, `Tool` / `Skill` / `Agent`, `RunBuilder`, `executeRun`, built-in tools |

### LLM providers

| Package | Role |
|---------|------|
| [`@opencoreagents/adapters-openai`](packages/adapters-openai/README.md) | OpenAI chat + embeddings |
| [`@opencoreagents/adapters-anthropic`](packages/adapters-anthropic/README.md) | Anthropic Messages API (`AnthropicLLMAdapter`) |

### Redis, vector search, and job queues

| Package | Role |
|---------|------|
| [`@opencoreagents/adapters-redis`](packages/adapters-redis/README.md) | TCP Redis: memory, `RunStore`, `MessageBus`, `RedisDynamicDefinitionsStore` (`DynamicDefinitionsStore`: `store.methods` + `store.Agent` / `Skill` / `HttpTool`) |
| [`@opencoreagents/adapters-upstash`](packages/adapters-upstash/README.md) | Upstash REST Redis + vector |
| [`@opencoreagents/adapters-bullmq`](packages/adapters-bullmq/README.md) | BullMQ queue/worker (re-exports `dispatchEngineJob` from `core`) |

### Dynamic definitions

| Package | Role |
|---------|------|
| [`@opencoreagents/dynamic-definitions`](packages/dynamic-definitions/README.md) | Store + upsert/sync agents, skills, HTTP tools into the registry |

### HTTP tools, messaging, and REST

| Package | Role |
|---------|------|
| [`@opencoreagents/adapters-http-tool`](packages/adapters-http-tool/README.md) | JSON-configured HTTP `ToolAdapter`s (`registerHttpToolsFromDefinitions`) |
| [`@opencoreagents/conversation-gateway`](packages/conversation-gateway/README.md) | Normalized inbound messages + gateway helpers for webhooks |
| [`@opencoreagents/rest-api`](packages/rest-api/README.md) | Express **`createRuntimeRestRouter`** — JSON routes per [`docs/planning/plan-rest.md`](docs/planning/plan-rest.md) after **`Agent.define`** |

### RAG and shared utilities

| Package | Role |
|---------|------|
| [`@opencoreagents/rag`](packages/rag/README.md) | File/RAG tools + skills |
| [`@opencoreagents/utils`](packages/utils/README.md) | Parsers, chunking, file resolver |

### CLI and scaffolding

| Package | Role |
|---------|------|
| [`@opencoreagents/cli`](packages/cli/README.md) | `runtime` CLI (`init`, `generate`, …) |
| [`@opencoreagents/scaffold`](packages/scaffold/README.md) | Programmatic project generation |

### Assistant skills (Cursor / Claude / Codex)

| Package | Role |
|---------|------|
| [`@opencoreagents/code-skills`](packages/code-skills/README.md) | **`SKILL.md`** skill trees under `packages/code-skills/skills/<id>/` (after `pnpm build --filter=@opencoreagents/code-skills`, or `dist/skills/<id>/` when published) — workspace map, engine, REST/workers, RAG. **Not** runtime `Skill.define`; see [Coding assistant skill packs](#coding-assistant-skill-packs). |

### OpenClaw-compatible skills (runtime)

| Package | Role |
|---------|------|
| [`@opencoreagents/skill-loader-openclaw`](packages/skill-loader-openclaw/) | **OpenClaw / AgentSkills**-style **`SKILL.md`** on disk: **`loadOpenClawSkills`**, load-time gates, optional **`registerOpenClawExecTool`**, ClawHub HTTP install. **Runnable demo:** [`examples/load-openclaw-skills`](examples/load-openclaw-skills/) ([`README.md`](examples/load-openclaw-skills/README.md), [`add-skills.md`](examples/load-openclaw-skills/add-skills.md)). |

---

## Examples

**Index (all 11 samples, scripts, backlog):** [`examples/README.md`](examples/README.md).

### Core loop and tools

- **Runnable minimal run:** [`examples/minimal-run`](examples/minimal-run/) — mock LLM, no keys.
- **OpenClaw / AgentSkills `SKILL.md` packs + `exec`:** [`examples/load-openclaw-skills`](examples/load-openclaw-skills/) — **`@opencoreagents/skill-loader-openclaw`** (`loadOpenClawSkills`, `registerOpenClawExecTool`); mock LLM, no API keys.
- **OpenAI + tool + skill:** [`examples/openai-tools-skill`](examples/openai-tools-skill/) — requires `OPENAI_API_KEY`.
- **Console `wait` + stdin:** [`examples/console-wait`](examples/console-wait/).

### RAG and support-style flows

- **RAG + catalog:** [`examples/rag`](examples/rag/).
- **RAG + support ticket tool:** [`examples/rag-contact-support`](examples/rag-contact-support/) — `contact_support` after KB search (scripted LLM).

### HTTP and multi-agent

- **Multi-agent (in-process bus):** [`examples/multi-agent`](examples/multi-agent/).
- **Express HTTP API + static HTML/JS UI (chat, SSE hook stream, `/status`, run + session status, wait/resume):** [`examples/real-world-with-express`](examples/real-world-with-express/).
- **Telegram-shaped webhook + `ConversationGateway` (mock outbound, no Bot API keys):** [`examples/telegram-example-mocked`](examples/telegram-example-mocked/).

### REST and dynamic definitions

- **Plan-shaped REST (`@opencoreagents/rest-api`):** [`examples/plan-rest-express`](examples/plan-rest-express/) — minimal Express with **`createRuntimeRestRouter`** and in-code **`Agent.define`**; routes match [`docs/planning/plan-rest.md`](docs/planning/plan-rest.md) (`GET /agents`, `POST /agents/:id/run`, …).

- **Dynamic definitions + HTTP API + BullMQ:** [`examples/dynamic-runtime-rest`](examples/dynamic-runtime-rest/) — **`RedisDynamicDefinitionsStore`**, Express control plane (custom routes that write definitions and enqueue jobs), worker with **`dynamicDefinitionsStore`** / **`runtime.dispatch`** and per-job hydration (**`@opencoreagents/dynamic-definitions`**). For **`createRuntimeRestRouter`** only, use [`examples/plan-rest-express`](examples/plan-rest-express/). Doc: [`docs/core/21-dynamic-runtime-rest.md`](docs/core/21-dynamic-runtime-rest.md).

---

## Docs

**Start here**

- [`docs/getting-started.md`](docs/getting-started.md) — tutorial, architecture summary, further reading ([`docs/README.md`](docs/README.md) is a short index that points there first)
- [`examples/README.md`](examples/README.md) — runnable **`examples/*`** workspace packages (minimal run, RAG, REST, BullMQ + Redis defs, …)

**Engine and layout**

- [`docs/core/README.md`](docs/core/README.md) — engine reference
- [`docs/planning/scaffold.md`](docs/planning/scaffold.md) — monorepo layout

### Coding assistant skill packs

[`packages/code-skills/README.md`](packages/code-skills/README.md) (**[`@opencoreagents/code-skills`](packages/code-skills/README.md)**) ships **agent-oriented** markdown for IDEs: each `skills/<id>/SKILL.md` bundles focused instructions and a subset of `docs/` (and package README stubs) so assistants stay aligned with **`@opencoreagents/*`**. Skill ids include **`opencoreagents-workspace`**, **`opencoreagents-engine`**, **`opencoreagents-rest-workers`**, and **`opencoreagents-rag-dynamic`**. From a clone, run **`pnpm build --filter=@opencoreagents/code-skills`** so generated `docs/` / `packages/` folders exist next to each skill; from a registry install, use paths under **`node_modules/.../dist/skills/<id>/`**.

**APIs and dynamic config**

- [`docs/planning/plan-rest.md`](docs/planning/plan-rest.md) — REST API shape (roadmap + plugin)
- [`docs/core/21-dynamic-runtime-rest.md`](docs/core/21-dynamic-runtime-rest.md) — dynamic definitions, Redis, workers (no redeploy for prompt/tool edits)

### Planning

- [`docs/planning/README.md`](docs/planning/README.md) — index (plan, scaffold, technical debt, REST, CLI, MCP)
- [`docs/planning/plan.md`](docs/planning/plan.md) — implementation plan
- [`docs/planning/technical-debt.md`](docs/planning/technical-debt.md) — known gaps (hub; priority splits: [`technical-debt-security-production.md`](docs/planning/technical-debt-security-production.md), [`technical-debt-platform-core-ci.md`](docs/planning/technical-debt-platform-core-ci.md), [`technical-debt-deferred.md`](docs/planning/technical-debt-deferred.md))

---

## Develop

```bash
pnpm install
pnpm turbo run build test lint
```

CI runs the same via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### GitHub Packages

**Maintainers only.** The workflow [`.github/workflows/publish.yml`](.github/workflows/publish.yml) builds every `packages/*` workspace package and runs **`pnpm publish -r`** against **`https://npm.pkg.github.com`**. It uses **`GITHUB_TOKEN`**, which only authorizes publishes **for this repository**—not for arbitrary forks publishing the same package names.

- **Manual:** Actions → *Publish to GitHub Packages* → run workflow. Leave **dry run** checked to verify without uploading; uncheck to publish (**requires** `packages: write` / maintainer role on **this** repo).
- **Release:** Publishing a **GitHub Release** (not only a git tag) runs the same path with **dry run** off. Bump `version` in each `packages/*/package.json` before the release so the registry accepts it.
- **Scope:** Packages are **`@opencoreagents/*`**. GitHub ties that npm scope to the **repository owner** (user or org). If the repo is not under the `opencoreagents` account, either move it there or rename the scope in every `package.json`.
- **Consumers (after a maintainer has published):** Copy [`.npmrc.example`](.npmrc.example) to `.npmrc`, add a PAT with `read:packages` (and SSO if your org requires it), then install `@opencoreagents/...` from the GitHub registry. Until then, depend on **git + workspace** or **path** dependencies from a clone.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE).
