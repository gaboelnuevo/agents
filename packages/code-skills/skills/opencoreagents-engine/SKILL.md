---
name: opencoreagents-engine
description: Implement or debug @opencoreagents/core — AgentRuntime, Agent.load, RunBuilder, Tool.define, Skill.define, Session, RunStore, wait/resume, adapters.
---

# OpenCore Agents — engine (`@opencoreagents/core`)

> **Bundled docs:** **`docs/`** next to this file. Paths below are relative to that folder (`docs/core/...`, `docs/planning/...`). API: `skillDocsDirectory("opencoreagents-engine")`.

Use when changing **runtime behavior**, **definitions** (`Tool` / `Skill` / `Agent`), or **adapter wiring**.

For the full monorepo layout and every `docs/core/` topic (including RAG, scaffold, multi-tenancy, and planning), enable the **`opencoreagents-workspace`** skill alongside this one.

The open-source **runtime** (this engine and sibling packages) lives at [OpenCoreAgents/runtime](https://github.com/OpenCoreAgents/runtime).

## Mental model

1. **`AgentRuntime`** holds adapters (`llmAdapter`, `memoryAdapter`, optional `runStore`, `messageBus`, `dynamicDefinitionsStore`, …).
2. **`Agent.define`** / **`Tool.define`** / **`Skill.define`** register config in-process (or hydrate from a store).
3. **`Agent.load(id, runtime, { session })`** returns an agent handle.
4. **`agent.run(input)`** returns **`RunBuilder`** → chain hooks → **`Run`** with **`history`** (`thought` / `action` / `observation` / `wait` / `result`).

## Where to read

- Purpose & shape: `docs/core/01-purpose.md`, `docs/core/02-architecture.md`, `docs/planning/mvp.md`
- Loop & state: `docs/core/03-execution-model.md`, `docs/core/04-protocol.md`
- Definitions: `docs/core/07-definition-syntax.md`
- Adapters: `docs/core/05-adapters-contracts.md`, `docs/core/06-adapters-infrastructure.md`
- LLM contract: `docs/core/10-llm-adapter.md`
- Context & tools in prompt: `docs/core/11-context-builder.md`
- Skills vs tools: `docs/core/12-skills.md`
- Failures & recovery: `docs/core/13-errors-parsing-and-recovery.md`
- Scope & production checklist: `docs/core/08-scope-and-security.md`
- Multi-agent: `docs/core/09-communication-multiagent.md`
- Cluster / workers: `docs/core/19-cluster-deployment.md`

## Fragments from `examples/minimal-run`

Deterministic **`LLMAdapter`**: return JSON **`thought`** then **`result`** so the loop finishes without API keys.

```typescript
// Adapted from examples/minimal-run/src/main.ts
import type { LLMAdapter, LLMRequest, LLMResponse } from "@opencoreagents/core";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@opencoreagents/core";

class DeterministicDemoLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({ type: "thought", content: "Plan a one-line greeting for the demo." })
        : JSON.stringify({ type: "result", content: "Hello from the minimal runtime example." });
    return { content };
  }
}

const runtime = new AgentRuntime({
  llmAdapter: new DeterministicDemoLlm(),
  memoryAdapter: new InMemoryMemoryAdapter(),
  maxIterations: 10,
});

await Agent.define({
  id: "demo-greeter",
  projectId: "demo-project",
  systemPrompt: "You are a helpful assistant.",
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

const agent = await Agent.load("demo-greeter", runtime, {
  session: new Session({ id: "demo-session-1", projectId: "demo-project" }),
});
const run = await agent.run("Say hello.");

const result = run.history.find((h) => h.type === "result");
```

## Fragments from `examples/openai-tools-skill`

**`Tool.define`** then **`Skill.define`**; the agent lists **`skills`** only (tools are on the skill). OpenAI **`tool_calls`** map to engine **`action`** steps.

```typescript
// Adapted from examples/openai-tools-skill/src/main.ts
import { OpenAILLMAdapter } from "@opencoreagents/adapters-openai";
import {
  Agent,
  AgentRuntime,
  Session,
  Skill,
  Tool,
  InMemoryMemoryAdapter,
} from "@opencoreagents/core";

const PROJECT_ID = "demo-openai";
const runtime = new AgentRuntime({
  llmAdapter: new OpenAILLMAdapter(process.env.OPENAI_API_KEY!),
  memoryAdapter: new InMemoryMemoryAdapter(),
  maxIterations: 15,
});

await Tool.define({
  id: "roll_dice",
  scope: "global",
  description: "Roll a single fair die with `sides` faces (minimum 2). Returns { side: number }.",
  inputSchema: {
    type: "object",
    properties: { sides: { type: "number" } },
    required: ["sides"],
  },
  execute: async (input: unknown) => {
    const sides = Math.max(2, Math.floor(Number((input as { sides?: unknown }).sides ?? 6)));
    return { side: 1 + Math.floor(Math.random() * sides), sides };
  },
});

await Skill.define({
  id: "dice-skill",
  projectId: PROJECT_ID,
  tools: ["roll_dice"],
  description: "Rolling dice for games and demos.",
});

await Agent.define({
  id: "demo-gamer",
  projectId: PROJECT_ID,
  systemPrompt: "When the user asks to roll, call roll_dice; after the observation, summarize.",
  skills: ["dice-skill"],
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

const agent = await Agent.load("demo-gamer", runtime, {
  session: new Session({ id: "session-openai-1", projectId: PROJECT_ID }),
});
await agent.run("Roll a twenty-sided die once.");
```

## Fragments from `examples/console-wait`

**`RunBuilder.onWait`**: mock LLM emits **`wait`** once; host collects input and returns resume text; next **`generate`** sees updated history and returns **`result`**.

```typescript
// Adapted from examples/console-wait/src/main.ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@opencoreagents/core";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@opencoreagents/core";

class WaitThenEchoLlm implements LLMAdapter {
  private turn = 0;
  constructor(private readonly userLine: { value: string }) {}
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    if (this.turn++ === 0) {
      return {
        content: JSON.stringify({
          type: "wait",
          reason: "I need one piece of input from you (prompt below).",
        }),
      };
    }
    const line = this.userLine.value.trim() || "(empty)";
    return { content: JSON.stringify({ type: "result", content: `Done. Received: «${line}».` }) };
  }
}

const PROJECT_ID = "demo-console-wait";
const userLine = { value: "" };
const runtime = new AgentRuntime({
  llmAdapter: new WaitThenEchoLlm(userLine),
  memoryAdapter: new InMemoryMemoryAdapter(),
  maxIterations: 10,
});

await Agent.define({
  id: "demo-cli-wait",
  projectId: PROJECT_ID,
  systemPrompt: "Protocol demo: you will wait once, then finish.",
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

const agent = await Agent.load("demo-cli-wait", runtime, {
  session: new Session({ id: "session-cli", projectId: PROJECT_ID }),
});

const run = await agent.run("Start the interactive flow.").onWait(async (step) => {
  const reason = step.type === "wait" ? step.reason : "";
  console.log(`Reason: ${reason}`);
  const rl = readline.createInterface({ input, output });
  const raw = await rl.question("Your line: ");
  rl.close();
  userLine.value = raw?.trim() ?? "";
  return userLine.value.length > 0 ? userLine.value : " ";
});
```

## Common pitfalls

- **`InMemoryMemoryAdapter`** is single-process only; multi-worker needs **Redis** / **Upstash** memory adapters.
- **`wait` across processes** needs **`RunStore`** + same session/run discipline (see cluster doc).
- **`SecurityContext`** is often **not** applied in `ContextBuilder` for tool hiding—see `docs/core/08-scope-and-security.md` and `docs/core/11-context-builder.md` (verify on [OpenCoreAgents/runtime](https://github.com/OpenCoreAgents/runtime) `main` if behavior changed).

## Full examples (monorepo clone)

Runnable sources for the fragments above: **`examples/minimal-run`**, **`examples/load-openclaw-skills`** (OpenClaw **`SKILL.md`** + **`skill-loader-openclaw`**), **`examples/openai-tools-skill`**, **`examples/console-wait`**. Paths exist only in a full clone of [OpenCoreAgents/runtime](https://github.com/OpenCoreAgents/runtime), not inside the npm skill tarball.
