# agent-runtime (monorepo)

Stateful agent **engine** for Node.js: a typed loop (`thought` → `action` → `observation` → `result`, plus `wait` / `resume`), pluggable adapters (LLM, memory, vector, queues), RAG tools, multi-agent messaging, and a CLI/scaffold.

---

## Not production-ready

This repository is a **library and research-oriented monorepo**, not a turnkey SaaS or a hardened platform. Before you ship anything customer-facing, read [**`docs/technical-debt.md`**](docs/technical-debt.md) and [**`docs/core/08-scope-and-security.md`**](docs/core/08-scope-and-security.md): auth and tenant isolation belong in **your** host layer; several adapters and examples are meant for **local demos** (mock LLM, in-memory vector, permissive roles). Use it to **build** your own API, workers, and policies—not as a drop-in production backend without review.

---

## Why developers use it

You define **tools**, **skills**, and **agents** in code (or hydrate from a store), wire a single **`AgentRuntime`** per process/worker, then **`Agent.load(id, runtime, { session })`** and **`run()`**. The engine handles the protocol loop, memory scopes, optional **`RunStore`** for cluster **`resume`**, and **`dispatchEngineJob(runtime, payload)`** for BullMQ workers—without hiding execution behind a global singleton.

**Minimal example** (no API keys; same idea as [`examples/minimal-run`](examples/minimal-run/)):

```typescript
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";

class DemoLlm implements LLMAdapter {
  private step = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.step++ === 0
        ? JSON.stringify({
            type: "thought",
            content: "Plan a one-line greeting.",
          })
        : JSON.stringify({
            type: "result",
            content: "Hello from agent-runtime.",
          });
    return { content };
  }
}

const runtime = new AgentRuntime({
  llmAdapter: new DemoLlm(),
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

**Promise-style run with per-step hooks** — `agent.run(input)` returns a **`RunBuilder`**: chain observers, then resolve to a **`Run`** (inspect **`run.history`** for the final **`result`** message).

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

Swap **`DemoLlm`** for **`OpenAILLMAdapter`** from **`@agent-runtime/adapters-openai`**, add **`@agent-runtime/adapters-redis`** for shared memory and **`@agent-runtime/adapters-bullmq`** for background jobs when you move past the demo.

---

## Packages

| Package | Role |
|---------|------|
| `@agent-runtime/core` | Engine, `Tool` / `Skill` / `Agent`, `RunBuilder`, `executeRun`, built-in tools |
| `@agent-runtime/adapters-openai` | OpenAI chat + embeddings |
| `@agent-runtime/adapters-redis` | TCP Redis: memory, `RunStore`, `MessageBus` |
| `@agent-runtime/adapters-upstash` | Upstash REST Redis + vector |
| `@agent-runtime/adapters-bullmq` | BullMQ queue/worker + `dispatchEngineJob` |
| `@agent-runtime/utils` | Parsers, chunking, file resolver |
| `@agent-runtime/rag` | File/RAG tools + skills |
| `@agent-runtime/scaffold` | Programmatic project generation |
| `@agent-runtime/cli` | `agent-runtime` CLI (`init`, `generate`, …) |

---

## Examples

- **Runnable minimal run:** [`examples/minimal-run`](examples/minimal-run/) — mock LLM, no keys.
- **OpenAI + tool + skill:** [`examples/openai-tools-skill`](examples/openai-tools-skill/) — requires `OPENAI_API_KEY`.
- **Console `wait` + stdin:** [`examples/console-wait`](examples/console-wait/).
- **RAG + catalog:** [`examples/rag`](examples/rag/).
- **RAG + support ticket tool:** [`examples/rag-contact-support`](examples/rag-contact-support/) — `contact_support` after KB search (scripted LLM).
- **Multi-agent (in-process bus):** [`examples/multi-agent`](examples/multi-agent/).
- **Express HTTP API + static HTML/JS UI (chat, SSE hook stream, `/status`, run + session status, wait/resume):** [`examples/real-world-with-express`](examples/real-world-with-express/).

---

## Docs

- **Getting started** (tutorial, architecture summary, further reading): [`docs/getting-started.md`](docs/getting-started.md)
- **Product / overview:** [`docs/README.md`](docs/README.md)
- **Engine reference:** [`docs/core/README.md`](docs/core/README.md)
- **Implementation plan:** [`docs/plan.md`](docs/plan.md)
- **Known gaps:** [`docs/technical-debt.md`](docs/technical-debt.md)
- **Monorepo layout:** [`docs/scaffold.md`](docs/scaffold.md)

---

## Develop

```bash
pnpm install
pnpm turbo run build test lint
```

CI runs the same via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## License

Private / TBD — see repository settings.
