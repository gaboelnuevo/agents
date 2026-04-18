# `@opencoreagents/dynamic-planner`

Registers **global** orchestration tools for a **Planner** agent: spawn sub-agents at runtime, wait on their runs, retry with corrections, and list tools/models before assigning work. Matches the design in [`docs/brainstorm/15-autonomous-agent-dynamic-planning.md`](../../docs/brainstorm/15-autonomous-agent-dynamic-planning.md).

The Planner delegates execution; sub-agents use normal tools and definitions.

## Tools (after registration)

| Id | Purpose |
|----|---------|
| `spawn_agent` | Writes an **ephemeral** sub-agent row via `definitionsStore.Agent.define`, then enqueues an engine run with a **stable `runId`** (required for waiting). Rows are per `agentId` under the project — reuse the same id in a later plan overwrites that definition. You do **not** pre-register sub-agents in Redis; the planner creates them with **unique `agentId`s** per subtask (e.g. suffix with planner `runId` or time). Optional **`onEphemeralSubAgentSpawned`** on `registerDynamicPlannerTools` lets you record ids for cleanup or metrics. |
| `wait_for_agents` | Polls `runStore.load(runId)` until completed, failed, or per-run timeout. |
| `reflect_and_retry` | Re-enqueues the same sub-agent with a corrective user message (retry budget in-tool). |
| `list_available_tools` | Project snapshot HTTP tools plus a fixed list of common builtins. |
| `list_available_models` | Optional model catalog or runtime-discovered models for explicit `llm` overrides. |

The **`@opencoreagents/runtime`** app additionally registers **`invoke_planner`**: enqueue the default orchestrator agent from another agent’s tool list. It returns **`runId`** immediately; the **calling run blocks only if** that agent also calls **`wait_for_agents`** on that id. See [`apps/runtime/docs/chat-runs-and-planner.md`](../../apps/runtime/docs/chat-runs-and-planner.md).

Sub-agent tool lists are checked against a built-in denylist (`spawn_agent`, `wait_for_agents`, `invoke_planner`, …) plus optional `forbiddenToolsForSubAgents`.

**Recursion:** `sessionContext.plannerDepth` is incremented for each spawned run; `maxPlannerDepth` (default `2`) caps nested spawning.

## Requirements

1. **`DynamicDefinitionsStore`** — same facade as `@opencoreagents/dynamic-definitions` (e.g. `RedisDynamicDefinitionsStore`). Workers must hydrate from this store (`AgentRuntime` + `dynamicDefinitionsStore`).

   Sub-agent definitions persist **`llm.provider`** and **`llm.model`** only. **Base URL / API keys** come from the worker’s **`AgentRuntime`** LLM adapters (e.g. OpenAI-compatible **`baseUrl`** applies to every agent with `provider: "openai"`). If your proxy uses non-standard model ids, pass them in **`spawn_agent`**’s `llm` field or set your app’s **`defaultSubAgentLlm.model`** accordingly.
2. **`RunStore`** — **shared** across the process that runs the Planner and the workers that execute sub-agents, so `wait_for_agents` sees updates. Use `RedisRunStore` / `UpstashRunStore` in production, or `InMemoryRunStore` only for single-process tests.
3. **`enqueueRun`** — typically `createEngineQueue(...).addRun` from `@opencoreagents/adapters-bullmq`. Payloads omit `kind`; the queue adds `kind: "run"`.

`@opencoreagents/core` supports optional **`runId`** on run jobs so the Planner can correlate jobs with `RunStore` rows (see `EngineRunJobPayload`).

`list_available_models` is intentionally conservative by default: if you do not provide `modelCatalog` or `resolveAvailableModels`, it returns deployment defaults and an empty `models` list rather than guessing public model ids that may not exist behind your configured adapters.

When model entries include `sourceRoles`, `list_available_models` also returns a `roles` map keyed by `provider:model` so operators can see whether a model came from the planner default, sub-agent default, chat default, or a custom resolver.

## Install

In this monorepo, depend on **`@opencoreagents/dynamic-planner`**, **`@opencoreagents/core`**, **`@opencoreagents/dynamic-definitions`**, and (for BullMQ) **`@opencoreagents/adapters-bullmq`**.

## Usage

Call **`registerDynamicPlannerTools(config)` once per Node process** at startup (with your other `Tool.define` registrations).

```typescript
import { createEngineQueue } from "@opencoreagents/adapters-bullmq";
import { registerDynamicPlannerTools } from "@opencoreagents/dynamic-planner";

const engine = createEngineQueue(queueName, connection);

await registerDynamicPlannerTools({
  definitionsStore: store,
  runStore,
  enqueueRun: (payload, opts) => engine.addRun(payload, opts),
  defaultSubAgentLlm: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  },
  // Optional:
  // maxPlannerDepth: 2,
  // forbiddenToolsForSubAgents: ["system_vector_delete"],
  // modelCatalog: myCatalog,
  // resolveAvailableModels: async ({ provider, ctx }) => myGateway.listModels({ provider, projectId: ctx.projectId }),
  // getQueuedJobCounts: () => engine.queue.getJobCounts("active", "waiting"),
  // maxConcurrentQueuedJobs: 20,
});
```

Define a **planner** agent (in code or via your definitions store) whose `tools` include the ids above plus memory helpers as needed, for example:

`spawn_agent`, `wait_for_agents`, `reflect_and_retry`, `list_available_tools`, `list_available_models`, `system_save_memory`, `system_get_memory`.

Use **`DEFAULT_PLANNER_SYSTEM_PROMPT`** from this package as a starting `systemPrompt`, or tailor it per product.

## Exports

- **`registerDynamicPlannerTools`**, **`DynamicPlannerToolsConfig`**, **`PlannerEnqueueRun`**, **`PlannerEnqueueOptions`**
- **`DEFAULT_PLANNER_SYSTEM_PROMPT`**
- **`DEFAULT_PLANNER_MODEL_CATALOG`** (example only), **`DEFAULT_MODEL_SELECTION_GUIDE`**, **`filterPlannerModelsByProvider`**, model types
- **`DEFAULT_BUILTIN_TOOLS_FOR_LISTING`** (what `list_available_tools` merges with HTTP tools from the snapshot)

## Related packages

- **`@opencoreagents/dynamic-definitions`** — store + hydrate for runtime agent rows.
- **`@opencoreagents/adapters-bullmq`** — typed queue `addRun` / worker processor.
- **`@opencoreagents/adapters-redis`** — `RedisRunStore`, `RedisDynamicDefinitionsStore`.

## Related docs

[`docs/brainstorm/15-autonomous-agent-dynamic-planning.md`](../../docs/brainstorm/15-autonomous-agent-dynamic-planning.md)
