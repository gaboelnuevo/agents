# Getting Started

This guide explains what the agents framework is, how it behaves architecturally, and how to set up an agent workflow end to end. Topics such as adapters, multi-tenancy, RAG, cluster deployment, and consumer APIs are only summarized here — see [§15 Further reading](#15-further-reading).

> **npm package name TBD.** The public package name and scope are not decided yet. Install commands and `import` paths use the placeholder **`@your-scope/agents`** — replace it with the real package name once it is published.

---

## 1. What this framework is

The agents framework is **not a simple wrapper around an LLM**. It is a **stateful workflow engine** built from:

- **Runtime:** Orchestrates agent executions.
- **Session:** Identifies a conversation and **tenant** (`projectId`) when you load an agent — memory scopes and policies apply per session.
- **Tools:** Atomic actions agents can perform.
- **Skills:** Reusable groupings of tools.
- **Agents:** Combine skills, tools, and a system prompt (definitions include **`projectId`** for isolation).
- **Protocol:** Structured LLM responses (`thought`, `action`, `wait`, `result`).
- **RunStore:** Optional persistence for resumable workflows.
- **Hooks:** Observability and auditing of agent behavior.

---

## 2. Key architectural insights

### 2.1 Execution model

- Every agent invocation creates a **Run** (execution instance).
- Runs follow a **state machine**: `initialized → running ↔ waiting → completed | failed`.
- The LLM does **not** return unconstrained free text for the engine to treat as the final answer; it must emit **structured steps** the engine can parse and dispatch.
- The engine supports **parse recovery** when the model returns invalid JSON.

### 2.2 Protocol

The framework expects JSON objects with a `type` field:

| Type      | Description |
|-----------|-------------|
| `thought` | Internal reasoning; engine continues. |
| `action`  | Execute a named tool; engine runs it. |
| `wait`    | Pause until human input or an external event. |
| `result`  | Final output; the run completes. |

**Important:** Plain text outside this protocol is not processed as a valid step.

### 2.3 Lifecycle hooks

Typical hooks include `onThought`, `onAction`, `onObservation`, `onWait`, `onResult`, and `onError` — useful for logging, dashboards, and auditing.

### 2.4 Wait and resume

- `wait` steps **pause** the workflow; state can be **persisted**.
- Resume with `runtime.resume(runId, input)` for multi-turn or async external events.

### 2.5 Max iterations vs LLM calls

- `maxIterations` caps **successfully parsed steps**, not every raw model call.
- Parse-recovery attempts typically **do not** consume iteration budget the same way, keeping behavior predictable.

### 2.6 Comparison with other approaches

- Unlike thin agent wrappers, this model emphasizes **stateful, resumable** runs.
- It is closer in spirit to **durable workflow engines + LLM planning** than to a single-shot chat completion.
- The LLM behaves as a **planner**; the runtime is the **executor** and gatekeeper for tools and persistence.

---

## 3. Fit and trade-offs

### 3.1 Recommended use cases

1. Multi-turn workflows with user input.
2. Processes that wait on external events.
3. Auditable, step-by-step decisions.
4. Orchestration across multiple tools.
5. Systems that need logs and traceability.

### 3.2 Strengths

- Structured, predictable stepping.
- Stateful, resumable workflows.
- Hooks for observability.
- Parse recovery for brittle model output.
- Multi-step and async-friendly.
- Token accounting (`promptTokens`, `completionTokens`, `wastedTokens`) where supported.

### 3.3 Potential drawbacks

- Opinionated; more setup than a minimal prompt wrapper.
- You need the **protocol + run state** mental model.
- A poor fit for “one prompt → one answer” if you do not need runs, tools, or waits.

---

## 4. Registration order (before you code)

End-to-end registration looks like this:

```txt
AgentRuntime()
   ↓
Tool.define()
   ↓
Skill.define()
   ↓
Agent.define()   ← includes projectId
   ↓
new Session({ id, projectId })   ← projectId matches the agent
   ↓
Agent.load(id, runtime, { session })
   ↓
agent.run(input)
```

Tools and skills **must** exist before the agent that references them. **`Session.projectId`** must match the **`projectId`** on **`Agent.define`** for that agent. Hooks and durable storage are optional but recommended for production-style workflows.

---

## 5. Install dependencies

```bash
npm install @your-scope/agents
```

or

```bash
yarn add @your-scope/agents
```

---

## 6. Create the agent runtime

The runtime orchestrates execution.

```ts
import { AgentRuntime } from "@your-scope/agents";
import { OpenAIAdapter, InMemoryMemoryAdapter, InMemoryRunStore } from "@your-scope/agents";

const runtime = new AgentRuntime({
  llmAdapter: new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }),
  memoryAdapter: new InMemoryMemoryAdapter(),
  runStore: new InMemoryRunStore(),
});
```

---

## 7. Define tools

Tools are atomic actions your agent can execute.

```ts
import { Tool } from "@your-scope/agents";

await Tool.define({
  id: "lookup_ticket",
  description: "Lookup a ticket by ID",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"]
  },
  execute: async ({ id }) => {
    return { ticket: { id, status: "open" } };
  }
});
```

---

## 8. Define skills

Skills group tools (and may add reusable logic).

```ts
import { Skill } from "@your-scope/agents";

await Skill.define({
  id: "ticketSupport",
  description: "Support workflow for tickets",
  tools: ["lookup_ticket"]
});
```

---

## 9. Define an agent

Agents combine skills, tools, and a system prompt.

```ts
import { Agent } from "@your-scope/agents";

await Agent.define({
  id: "support-agent",
  projectId: "demo-project",
  systemPrompt: `
    You are a support agent.
    Respond using structured steps: thought, action, wait, result.
  `,
  skills: ["ticketSupport"],
  tools: ["lookup_ticket"],
  llm: { provider: "openai", model: "gpt-4o" },
});
```

---

## 10. Session, load, and run

Each **`Agent.load`** is scoped with a **`Session`**: a stable **`id`** for the conversation (e.g. end-user or thread) and a **`projectId`** that must match the agent definition so memory and registry lookups stay in the right tenant.

```ts
import { Session } from "@your-scope/agents";

const session = new Session({
  id: "user-thread-1",
  projectId: "demo-project",
});

const agent = await Agent.load("support-agent", runtime, { session });

const run = await agent.run("Lookup ticket #123");
const resultMsg = run.history.find((h) => h.type === "result");
console.log(resultMsg?.content);
```

---

## 11. Handling wait steps

If the agent emits a `wait` step, execution pauses until you provide input (or an adapter delivers it).

```ts
await runtime.resume(runId, { userInput: "email@example.com" });
```

---

## 12. Observability hooks

```ts
agent.onThought((thought) => console.log("Thought:", thought.text));
agent.onAction((action) => console.log("Action:", action.tool));
agent.onObservation((obs) => console.log("Observation:", obs.value));
agent.onWait((wait) => console.log("Waiting:", wait.reason));
agent.onResult((result) => console.log("Result:", result.output));
```

---

## 13. Example step sequence

1. Agent receives input.
2. Emits `thought` (optional reasoning).
3. Emits `action` → tool runs → `observation` feeds the next turn.
4. May emit `wait` for external input.
5. Ends with `result`.

---

## 14. Summary

- **Runtime** orchestrates agents; **RunStore** enables resume.
- **Session** (`id` + **`projectId`**) is required when loading an agent so runs and memory are scoped correctly; **`projectId`** on **`Agent.define`** and **`Session`** must align.
- **Tools** and **skills** are registered before **agents**.
- **Protocol:** structured steps (`thought`, `action`, `wait`, `result`); observations follow tool execution in the loop.
- **Hooks** support debugging and audit trails.

For lightweight, single-step LLM use cases, a smaller stack may be enough. For **stateful, auditable, multi-step** workflows, this shape of engine provides the control and persistence that thin wrappers usually omit.

---

## 15. Further reading

The sections below point to documentation in this repository that goes beyond this tutorial. Paths are relative to the `docs/` folder unless noted.

### Repository overview and status

| Resource | What you get |
|----------|----------------|
| [Documentation index](./README.md) | Hub: **Getting started** (this guide), **[Agent Engine overview](./planning/agent-engine-overview.md)** (full narrative), quick links to **Engine reference** and other docs. |
| [Repository root README](../README.md) | Monorepo layout, `pnpm` / Turbo commands, how packages relate. |
| [plan.md](./planning/plan.md) | Roadmap and implementation progress. |
| [technical-debt.md](./planning/technical-debt.md) | Known gaps (hub; triage [security & production](./planning/technical-debt-security-production.md) before [deferred / examples](./planning/technical-debt-deferred.md)). |

### Core engine reference (`docs/core/`)

The **canonical index** of engine topics (one table with every core doc) is [core/README.md](./core/README.md). Use it as the starting point for deep dives.

Highlights that this guide does **not** spell out:

| Topic | Document |
|--------|----------|
| Internal components and boundaries | [core/02-architecture.md](./core/02-architecture.md) |
| Run lifecycle, states, **RunStore**, wait/resume mechanics | [core/03-execution-model.md](./core/03-execution-model.md) |
| Message envelope, protocol rules, durable **waiting** | [core/04-protocol.md](./core/04-protocol.md) |
| **Adapters**: memory, tools, RunStore; OpenAI / Anthropic; **Redis** (TCP); Upstash; **BullMQ** queues; **HTTP tools** JSON + **dynamic-definitions**; per-tool timeouts | [core/05-adapters-contracts.md](./core/05-adapters-contracts.md), [core/06-adapters-infrastructure.md](./core/06-adapters-infrastructure.md) |
| **`Tool.define` / `Skill.define` / `Agent.define`**, `defineBatch`, persisted shapes | [core/07-definition-syntax.md](./core/07-definition-syntax.md) |
| **`scope`**, **`projectId`**, **SecurityLayer**, production checklist | [core/08-scope-and-security.md](./core/08-scope-and-security.md) |
| **MessageBus**, **`system_send_message`**, multi-agent **wait**/**resume** | [core/09-communication-multiagent.md](./core/09-communication-multiagent.md) |
| **LLMAdapter** contract, multiple providers on **AgentRuntime** | [core/10-llm-adapter.md](./core/10-llm-adapter.md) |
| **Context builder**: prompt ordering, truncation, **effectiveToolAllowlist** | [core/11-context-builder.md](./core/11-context-builder.md) |
| **Skills** vs tools, resolution, **`defineBatch`** | [core/12-skills.md](./core/12-skills.md) |
| Errors, abort/timeout, **parse recovery** and re-prompt | [core/13-errors-parsing-and-recovery.md](./core/13-errors-parsing-and-recovery.md) |
| **Consumers**: SDK, BullMQ worker, CLI, REST, MCP | [core/14-consumers.md](./core/14-consumers.md) |
| **Multi-tenancy**: orgs, projects, end-users, memory scoping | [core/15-multi-tenancy.md](./core/15-multi-tenancy.md) |
| **RAG**: embeddings, vector adapters, catalog tools, patterns | [core/17-rag-pipeline.md](./core/17-rag-pipeline.md) |
| **Scaffold** CLI (`init`, `generate`, templates) | [core/18-scaffold.md](./core/18-scaffold.md) |
| **Cluster**: shared Redis, RunStore, MessageBus, horizontal scaling | [core/19-cluster-deployment.md](./core/19-cluster-deployment.md) |
| **HTTP tools from JSON** (`adapters-http-tool`) | [core/20-http-tool-adapter.md](./core/20-http-tool-adapter.md) |
| **Dynamic definitions** store + hydrate (`dynamic-definitions`, Redis REST) | [core/21-dynamic-runtime-rest.md](./core/21-dynamic-runtime-rest.md) |

Additional core docs: purpose ([core/01-purpose.md](./core/01-purpose.md)); MVP scope and risks ([planning/mvp.md](./planning/mvp.md)); internal **utils** ([core/16-utils.md](./core/16-utils.md)).

### Runnable examples

| Resource | What you get |
|----------|----------------|
| [examples/README.md](../examples/README.md) | Table of **`examples/*`** packages: minimal run, **OpenClaw / AgentSkills `SKILL.md`** (**`load-openclaw-skills`**), OpenAI + tools, **`wait`** in the console, RAG, multi-agent, Express BFF, **`plan-rest-express`** (`createRuntimeRestRouter`), dynamic-runtime REST, Telegram-shaped gateway mock, and how to run them. |

### Integration and product plans (drafts)

| Resource | What you get |
|----------|----------------|
| [planning/README.md](./planning/README.md) | Index: reading order, roadmap, monorepo **scaffold** spec, technical debt, REST, CLI, MCP. |
| [planning/scaffold.md](./planning/scaffold.md) | Monorepo package map, dependency graph, and codegen blueprint. |
| [plan-rest.md](./planning/plan-rest.md) | REST roadmap + **`@opencoreagents/rest-api`** (`createRuntimeRestRouter`, **`resolveApiKey`**, tenancy) + **`plan-rest-express`**; BFF: `real-world-with-express`; async: `dynamic-runtime-rest`. |
| [plan-cli.md](./planning/plan-cli.md) | CLI direction. |
| [plan-mcp.md](./planning/plan-mcp.md) | MCP direction. |

### Design brainstorms (non-normative)

Notes and proposals under [brainstorm/](./brainstorm/) are background — not guaranteed to match current code. Example: [conversation gateway + messaging channels](./brainstorm/14-conversation-gateway-implementation-proposal.md).

---
