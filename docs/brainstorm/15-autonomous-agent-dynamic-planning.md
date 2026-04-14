# Autonomous Agent with Dynamic Planning

**Implementation proposal for OpenCoreAgents Runtime**

---

## Table of contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Existing primitives to reuse](#3-existing-primitives-to-reuse)
4. [New tools to implement](#4-new-tools-to-implement)
5. [The Planner agent](#5-the-planner-agent)
6. [Example flows](#6-example-flows)
7. [Template system](#7-template-system)
8. [Security controls](#8-security-controls)
9. [Implementation roadmap](#9-implementation-roadmap)
10. [Production considerations](#10-production-considerations)

---

## 1. Overview

The goal is to build a **meta-agent** that can decompose complex goals, create specialized sub-agents at runtime, run them in parallel or in sequence, evaluate their outputs, and aggregate a coherent final answer—all without redeploying workers.

The repository already exposes the necessary primitives. What is missing is wiring them together with four new tools (`spawn_agent`, `wait_for_agents`, `reflect_and_retry`, `list_available_models`) plus a well-designed planning system prompt.

### Design principle

> The Planner does not execute tasks. It delegates, coordinates, and aggregates.

The Planner’s LLM acts strictly as an **orchestrator**: it decides which sub-agents to create, with what instructions, in what order, and when to merge results. Sub-agents are the ones that touch tools, APIs, and real data.

---

## 2. Architecture

```
User
   │  "Analyze Q1 sales and produce a report with charts"
   ▼
┌──────────────────────────────────────────┐
│            Planner Agent                 │
│  model: claude-opus-4                    │
│  tools: spawn_agent, wait_for_agents,    │
│          reflect_and_retry,              │
│          list_available_tools,           │
│          list_available_models,          │
│          system_save_memory              │
└────────┬─────────────────────────────────┘
         │
         │  spawn_agent("data-analyst",  input="Extract Q1 sales from SQL")
         │  spawn_agent("chart-builder", input="Build a bar chart")
         │  spawn_agent("writer",        input="Draft executive summary")
         │
         ▼  (parallel execution via BullMQ)
┌───────────────────────────────────────────────────┐
│         Sub-agents (created at runtime)           │
│                                                    │
│  data-analyst   → sql_query, export_csv            │
│  chart-builder  → plotly_chart, save_image         │
│  writer         → system_vector_search, drafting   │
└───────────────────────────────────────────────────┘
         │
         │  wait_for_agents([runId1, runId2, runId3])
         │
         ▼
┌──────────────────────────────────────────┐
│    Planner aggregates results            │
│    reflect_and_retry if any failed       │
│    result → final answer to the user     │
└──────────────────────────────────────────┘
```

### System layers

| Layer | Responsibility | Package |
|------|----------------|---------|
| **Store** | Agent/skill/tool definitions in Redis | `adapters-redis` |
| **Queue** | Async job execution without blocking HTTP | `adapters-bullmq` |
| **RunStore** | Run state for polling and resume | `adapters-redis` |
| **Planner** | Orchestration, planning, aggregation | `core` |
| **Sub-agents** | Task-specific execution | `core` |
| **Memory** | In-flight plan, learning across runs | `adapters-redis` |

---

## 3. Existing primitives to reuse

Nothing needs to be built from scratch. The Planner reuses:

### `RedisDynamicDefinitionsStore`

Lets you create a sub-agent definition as JSON in Redis at runtime. The worker that picks up the next job already sees the definition—no redeploy.

```typescript
await store.Agent.define(projectId, {
  id: "data-analyst-run-001",
  projectId,
  systemPrompt: "You are a data analyst specialized in SQL...",
  tools: ["sql_query", "export_csv"],
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
});
```

### `dispatchEngineJob`

Enqueues agent execution on BullMQ. The Planner can fire multiple jobs in parallel without blocking its own loop.

```typescript
const job = await dispatchEngineJob(queue, {
  type:      "run",
  agentId:   "data-analyst-run-001",
  projectId,
  sessionId: `spawned-${Date.now()}`,
  runId:     `run-${Date.now()}`,
  input:     { type: "text", content: "Extract Q1 2026 sales" },
});
```

### `RunStore`

Lets the Planner inspect run state from any process or worker. This underpins polling in `wait_for_agents`.

```typescript
const run = await runStore.get(runId);
if (run.status === "completed") {
  const result = run.history.findLast(h => h.type === "result");
}
```

### `MessageBus` + `system_send_message`

For flows where sub-agents must coordinate with each other (not only with the Planner). Supports request/reply via `correlationId`.

### `wait` / `resume`

The Planner can emit `wait` before running an expensive plan, surfacing the proposed plan for user approval. The user continues with `runtime.resume()`.

### `system_save_memory` / `system_get_memory`

The Planner stores the in-flight plan in `working` memory so it can recover after a mid-run failure or a `wait` across turns.

---

## 4. New tools to implement

### 4.1 `spawn_agent`

The main tool. Creates the sub-agent definition in Redis and enqueues execution. Returns `jobId` and `runId` for monitoring.

```typescript
await Tool.define({
  id:          "spawn_agent",
  scope:       "global",
  description:
    "Creates a specialized agent for a concrete goal and runs it in the background. " +
    "Returns jobId and runId for wait_for_agents. " +
    "NEVER include spawn_agent in the sub-agent's tool list.",
  inputSchema: {
    type: "object",
    properties: {
      agentId: {
        type:        "string",
        description: "Unique id for this agent. Use snake_case. Include parent run id to avoid collisions.",
      },
      systemPrompt: {
        type:        "string",
        description: "Full, specific instructions for the sub-agent. More precise prompts yield better results.",
      },
      tools: {
        type:        "array",
        items:       { type: "string" },
        description: "Tool ids available to this sub-agent. Must exist in the registry.",
      },
      input: {
        type:        "string",
        description: "First task/message for the sub-agent.",
      },
      priority: {
        type:        "string",
        enum:        ["low", "normal", "high"],
        description: "BullMQ queue priority.",
        default:     "normal",
      },
    },
    required: ["agentId", "systemPrompt", "tools", "input"],
  },

  execute: async ({ agentId, systemPrompt, tools, input, priority = "normal" }, context) => {
    const projectId = context.session!.projectId;
    const depth     = (context.session?.sessionContext as any)?.plannerDepth ?? 0;

    // Recursion guard — sub-agents must not spawn further sub-agents beyond the limit
    if (depth >= 2) {
      throw new Error(`plannerDepth ${depth} exceeds limit of 2. Sub-agents cannot create more agents.`);
    }

    const sessionId = `spawned-${agentId}-${Date.now()}`;
    const runId     = `run-${agentId}-${Date.now()}`;

    // 1. Create sub-agent definition in Redis (visible to workers on the next job)
    await store.Agent.define(projectId, {
      id: agentId,
      projectId,
      systemPrompt,
      tools,
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    });

    // 2. Enqueue run with depth carried in session context
    const job = await dispatchEngineJob(queue, {
      type:      "run",
      agentId,
      projectId,
      sessionId,
      runId,
      input:     { type: "text", content: input },
      sessionContext: { plannerDepth: depth + 1 },
    }, {
      priority: priority === "high" ? 1 : priority === "low" ? 10 : 5,
      attempts: 3,
      backoff:  { type: "exponential", delay: 2000 },
    });

    return { jobId: job.id, runId, sessionId, agentId, status: "queued" };
  },
});
```

---

### 4.2 `wait_for_agents`

Waits for a set of sub-agents to finish. Supports parallel runs and a per-agent timeout.

```typescript
await Tool.define({
  id:          "wait_for_agents",
  scope:       "global",
  description:
    "Waits for sub-agents started with spawn_agent to finish. " +
    "Returns results for completed runs and errors for failed ones. " +
    "Call after all spawn_agent calls in the same step.",
  inputSchema: {
    type: "object",
    properties: {
      runIds: {
        type:        "array",
        items:       { type: "string" },
        description: "runIds to wait for (from spawn_agent).",
      },
      timeoutMs: {
        type:        "number",
        description: "Timeout in ms per agent. Default: 120000 (2 min).",
        default:     120_000,
      },
      failOnAny: {
        type:        "boolean",
        description: "If true, fail as soon as any sub-agent fails. Default: false (aggregate what you can).",
        default:     false,
      },
    },
    required: ["runIds"],
  },

  execute: async ({ runIds, timeoutMs = 120_000, failOnAny = false }) => {
    const results:  Record<string, string>  = {};
    const errors:   Record<string, string>  = {};
    const timings:  Record<string, number>  = {};

    await Promise.allSettled(
      runIds.map(async (runId) => {
        const start    = Date.now();
        const deadline = start + timeoutMs;

        while (Date.now() < deadline) {
          const run = await runStore.get(runId);

          if (!run) {
            errors[runId] = "run not found in RunStore";
            return;
          }

          if (run.status === "completed") {
            const msg = run.history.findLast(h => h.type === "result");
            results[runId]  = String(msg?.content ?? "");
            timings[runId]  = Date.now() - start;
            return;
          }

          if (run.status === "failed") {
            errors[runId] = run.error ?? "sub-agent failed with no message";
            if (failOnAny) throw new Error(`Sub-agent ${runId} failed: ${errors[runId]}`);
            return;
          }

          const elapsed = Date.now() - start;
          const delay   = elapsed < 10_000 ? 1000 : elapsed < 60_000 ? 3000 : 5000;
          await new Promise(r => setTimeout(r, delay));
        }

        errors[runId] = `timeout after ${timeoutMs}ms`;
        if (failOnAny) throw new Error(`Sub-agent ${runId}: ${errors[runId]}`);
      }),
    );

    return {
      results,
      errors,
      completed:    Object.keys(results).length,
      failed:       Object.keys(errors).length,
      timingsMs:    timings,
      allCompleted: Object.keys(errors).length === 0,
    };
  },
});
```

---

### 4.3 `reflect_and_retry`

Evaluates whether a sub-agent output meets given criteria. If not, re-runs with corrected instructions.

```typescript
await Tool.define({
  id:          "reflect_and_retry",
  scope:       "global",
  description:
    "Checks whether a sub-agent output meets quality criteria. " +
    "If not, re-runs it with corrected instructions. Max 2 retries per sub-agent.",
  inputSchema: {
    type: "object",
    properties: {
      agentId:    { type: "string", description: "Sub-agent agentId to evaluate/re-run" },
      result:     { type: "string", description: "Sub-agent output" },
      criteria:   { type: "string", description: "What makes the output acceptable" },
      correction: { type: "string", description: "Corrective instruction if output is not acceptable" },
      retryCount: { type: "number", description: "Current retry count (0 = first evaluation)", default: 0 },
      maxRetries: { type: "number", default: 2 },
    },
    required: ["agentId", "result", "criteria", "correction"],
  },

  execute: async ({ agentId, result, criteria, correction, retryCount = 0, maxRetries = 2 }, context) => {
    const projectId = context.session!.projectId;

    if (retryCount >= maxRetries) {
      return {
        accepted:   false,
        reason:     `max retries (${maxRetries}) reached`,
        lastResult: result,
      };
    }

    // Quality acceptance is decided by the Planner in its next reasoning step;
    // this tool mainly handles re-enqueue when the Planner requests a retry.
    const sessionId = `retry-${agentId}-${Date.now()}`;
    const runId     = `run-retry-${agentId}-${Date.now()}`;

    const job = await dispatchEngineJob(queue, {
      type:      "run",
      agentId,
      projectId,
      sessionId,
      runId,
      input: {
        type:    "text",
        content: `RETRY ${retryCount + 1}/${maxRetries}.\n\nIssue with previous answer: ${correction}\n\nSuccess criteria: ${criteria}\n\nTry again.`,
      },
    });

    return {
      accepted:   false,
      retrying:   true,
      jobId:      job.id,
      runId,
      retryCount: retryCount + 1,
    };
  },
});
```

---

### 4.4 `list_available_tools`

Lets the Planner see which tools it can assign to sub-agents before defining them.

```typescript
await Tool.define({
  id:          "list_available_tools",
  scope:       "global",
  description: "Lists tools available in the registry for this project. Call before spawn_agent to choose tool sets.",
  inputSchema: { type: "object", properties: {}, required: [] },

  execute: async (_input, context) => {
    const projectId = context.session!.projectId;
    const snapshot  = await store.methods.getSnapshot(projectId);

    const httpTools = snapshot.httpTools.map(t => ({
      id:          t.id,
      description: t.description,
      type:        "http",
    }));

    const builtins = [
      { id: "system_get_memory",    description: "Read session or long-term memory", type: "builtin" },
      { id: "system_save_memory",   description: "Write session or long-term memory", type: "builtin" },
      { id: "system_vector_search", description: "Semantic search over knowledge base", type: "builtin" },
      { id: "system_file_ingest",   description: "Index a file into the vector store", type: "builtin" },
      { id: "system_send_message",  description: "Send a message to another agent", type: "builtin" },
    ];

    return { httpTools, builtins, total: httpTools.length + builtins.length };
  },
});
```

---

### 4.5 `list_available_models`

Lets the Planner pick the right model per sub-agent by complexity, cost, and capability. Without it, the Planner tends to assign one model to everyone.

```typescript
await Tool.define({
  id:    "list_available_models",
  scope: "global",
  description:
    "Lists available LLM models with provider, relative cost, and capabilities. " +
    "Call before spawn_agent to match model to subtask: " +
    "strong models for heavy reasoning, fast cheap models for simple tasks.",
  inputSchema: {
    type:       "object",
    properties: {
      provider: {
        type:        "string",
        enum:        ["anthropic", "openai", "all"],
        description: "Filter by provider. Default: all.",
        default:     "all",
      },
    },
    required: [],
  },

  execute: async ({ provider = "all" }) => {
    const catalog: ModelEntry[] = [
      {
        provider:     "anthropic",
        model:        "claude-opus-4-20250514",
        alias:        "opus",
        tier:         "flagship",
        costRelative: "high",
        contextWindow: 200_000,
        strengths:    ["complex reasoning", "planning", "advanced code", "long analysis"],
        recommended:  ["multi-step planning", "quality evaluation", "complex synthesis"],
        avoid:        ["simple repetitive tasks", "high-frequency calls"],
      },
      {
        provider:     "anthropic",
        model:        "claude-sonnet-4-20250514",
        alias:        "sonnet",
        tier:         "balanced",
        costRelative: "medium",
        contextWindow: 200_000,
        strengths:    ["speed/quality balance", "code", "data analysis", "writing"],
        recommended:  ["most sub-agents", "data analysis", "text generation"],
        avoid:        ["very complex reasoning that needs opus"],
      },
      {
        provider:     "anthropic",
        model:        "claude-haiku-4-5-20251001",
        alias:        "haiku",
        tier:         "fast",
        costRelative: "low",
        contextWindow: 200_000,
        strengths:    ["speed", "simple tasks", "classification", "structured extraction"],
        recommended:  ["format validation", "classification", "simple transforms", "high-frequency sub-agents"],
        avoid:        ["complex reasoning", "long generation"],
      },
      {
        provider:     "openai",
        model:        "gpt-4o",
        alias:        "gpt4o",
        tier:         "flagship",
        costRelative: "high",
        contextWindow: 128_000,
        strengths:    ["multimodal (vision)", "code", "reasoning", "native tool use"],
        recommended:  ["image/vision tasks", "complex code", "structured analysis"],
        avoid:        ["non-vision tasks where Sonnet is enough"],
      },
      {
        provider:     "openai",
        model:        "gpt-4o-mini",
        alias:        "gpt4o-mini",
        tier:         "fast",
        costRelative: "low",
        contextWindow: 128_000,
        strengths:    ["speed", "cost", "simple tasks", "basic vision"],
        recommended:  ["classification sub-agents", "entity extraction", "transforms"],
        avoid:        ["complex reasoning", "long synthesis"],
      },
    ];

    const filtered = provider === "all"
      ? catalog
      : catalog.filter(m => m.provider === provider);

    const selectionGuide = {
      "reasoning and planning":        "claude-opus-4-20250514",
      "data analysis / code":         "claude-sonnet-4-20250514",
      "classification / validation":  "claude-haiku-4-5-20251001",
      "image-heavy tasks":            "gpt-4o",
      "high-frequency transforms":    "claude-haiku-4-5-20251001 or gpt-4o-mini",
    };

    return {
      models:        filtered,
      total:         filtered.length,
      selectionGuide,
      note: "Prefer the cheapest model that is sufficient. Reserve opus for the Planner and evaluation sub-agents.",
    };
  },
});

interface ModelEntry {
  provider:      string;
  model:         string;
  alias:         string;
  tier:          "flagship" | "balanced" | "fast";
  costRelative:  "high" | "medium" | "low";
  contextWindow: number;
  strengths:     string[];
  recommended:   string[];
  avoid:         string[];
}
```

#### Why this tool matters

Without `list_available_models`, the Planner assigns one model to every sub-agent, which causes:

- **Overspend:** A sub-agent that only validates JSON shape does not need `claude-opus-4`. `claude-haiku` can be ~10× cheaper and equally effective.
- **Under-performance:** A sub-agent reasoning over a 50k-token document and synthesizing conclusions needs a capable model; `haiku` may produce weak output.

With this tool the Planner can reason explicitly, e.g.:

```
thought → "I have 4 subtasks:
           1. Extract data from SQL          → haiku (simple transform)
           2. Analyze trends                  → sonnet (data analysis)
           3. Evaluate analysis quality       → opus   (critical reasoning)
           4. Format output as JSON          → haiku  (simple transform)
           Estimated cost: much lower than opus for everything."
```

---

## 5. The Planner agent

### Definition

```typescript
await Agent.define({
  id:        "planner",
  projectId: "autonomous",
  systemPrompt: `
You are an autonomous planning agent. Your role is ONLY to orchestrate:
decompose goals, create specialized sub-agents, and aggregate results.
You do NOT execute tasks directly.

MANDATORY WORKFLOW:
1. PLAN: Analyze the goal and break it into independent subtasks.
   Use system_save_memory to store the plan (memoryType: "working").
2. LIST TOOLS AND MODELS: Use list_available_tools and list_available_models
   to know what you can assign and which model fits each subtask.
3. CREATE SUB-AGENTS: Use spawn_agent per subtask.
   - Pick the cheapest sufficient model (haiku for simple work,
     sonnet for analysis, opus only for very hard reasoning)
   - Independent subtasks → launch in parallel (several spawn_agent in a row)
   - Dependent subtasks → launch in sequence
   - Never put spawn_agent in a sub-agent's tool list
4. WAIT: Use wait_for_agents with all runIds from the previous step.
5. EVALUATE: Review each output. If any is insufficient, use reflect_and_retry.
6. AGGREGATE: Synthesize all outputs into one coherent answer.
7. FINISH: Emit result with the final user-facing answer.

RULES:
- Each sub-agent gets a specific systemPrompt scoped to ONE task
- Prefer parallelism: spawn as many sub-agents as possible before wait_for_agents
- If a sub-agent fails and is non-blocking, continue with the rest
- For complex or expensive plans: emit wait first so the user can approve
- Store learnings in longTerm memory for future plans

FORMAT: Reply ONLY with structured JSON:
{ "type": "thought" | "action" | "wait" | "result", ... }
  `.trim(),

  tools: [
    "spawn_agent",
    "wait_for_agents",
    "reflect_and_retry",
    "list_available_tools",
    "list_available_models",
    "system_save_memory",
    "system_get_memory",
  ],

  llm: {
    provider:    "anthropic",
    model:       "claude-opus-4-20250514",
    temperature: 0.2,
  },

  memoryConfig: {
    shortTerm: { maxTurns: 60 },
    working:   {},
    longTerm:  true,
  },
});
```

### Expected loop for a complex goal

```
User: "Analyze Q1 2026 sales and produce an executive report with charts"

thought  → "I split into 3 independent subtasks: data extraction, chart generation, writing."
action   → system_save_memory({ type: "working", content: JSON.stringify(plan) })
action   → list_available_tools()
action   → list_available_models()
thought  → "Model assignment by complexity:
            - data-analyst (simple SQL)  → haiku
            - chart-builder (visual logic) → sonnet
            - writer (executive synthesis) → sonnet
            I keep opus for reflect_and_retry if quality review is needed."
action   → spawn_agent({ agentId: "analyst-001", tools: ["sql_query"], ... })
action   → spawn_agent({ agentId: "charts-001",  tools: ["plotly_chart"], ... })
action   → spawn_agent({ agentId: "writer-001",  tools: ["drafting_tool"], ... })
action   → wait_for_agents({ runIds: ["run-analyst-001", "run-charts-001", "run-writer-001"] })
thought  → "All completed. I review each output."
thought  → "The chart is missing axis titles. Fix required."
action   → reflect_and_retry({ agentId: "charts-001", result: "...", criteria: "must have X and Y axis titles", correction: "Add descriptive axis titles" })
action   → wait_for_agents({ runIds: ["run-retry-charts-001"] })
thought  → "Chart is good. I have all outputs. Aggregating."
result   → "## Q1 2026 Sales Report\n\n[executive summary]\n\n[key figures]\n\n[conclusions]"
```

**Note:** `spawn_agent` should accept `llm` overrides (as in your examples) so the Planner can apply `list_available_models` choices; the snippet above uses `...` where the implementation extends the base `spawn_agent` schema.

---

## 6. Example flows

### Flow 1: Human-approved plan

For expensive plans (many sub-agents, long runtime), the Planner surfaces the plan before execution.

```
User: "Migrate all our technical docs to the new format"

thought  → "Large plan: ~20 sub-agents, ~2h estimated. I request approval."
wait     → {
  reason: "user_input",
  details: {
    question: "Here is the proposed plan:\n\n1. [sub-agent-1]: ...\n2. [sub-agent-2]: ...\n\nEstimate: 20 agents, ~2h. Approve?",
    plan: { steps: [...], estimatedAgents: 20, estimatedDurationMin: 120 }
  }
}

→ User approves via runtime.resume(runId, { userInput: "Yes, go ahead" })

thought  → "Plan approved. Executing in phases."
action   → spawn_agent(...)  // phase 1
...
```

### Flow 2: Orchestration with dependencies

When subtasks depend on each other:

```
thought  → "PDF needs data and charts first. Dependencies exist."

// Phase 1: independent work
action   → spawn_agent({ agentId: "data-001",   tools: ["sql_query"],    input: "..." })
action   → spawn_agent({ agentId: "assets-001", tools: ["fetch_images"], input: "..." })
action   → wait_for_agents({ runIds: ["run-data-001", "run-assets-001"] })

// Phase 2: depends on phase 1
action   → spawn_agent({ agentId: "pdf-001", tools: ["pdf_generator"], input: "Use this data: {results}" })
action   → wait_for_agents({ runIds: ["run-pdf-001"] })

result   → "PDF generated: ..."
```

### Flow 3: Multi-agent with MessageBus

When subtasks need to coordinate during execution:

```
// Planner spawns a coordinator that uses system_send_message
// to talk to specialist sub-agents while running

action → spawn_agent({
  agentId:      "coordinator",
  tools:        ["system_send_message", "data_tool"],
  systemPrompt: "Coordinate with researcher and validator via system_send_message.",
  input:        "Start market analysis",
})
```

---

## 7. Template system

Instead of generating `systemPrompt` from scratch every time, keep a catalog of predefined templates in Redis for consistency and lower token use.

### Template shape

```typescript
interface AgentTemplate {
  templateId:   string;
  name:           string;
  description:    string;  // what the Planner sees when listing templates
  systemPrompt:   string;  // supports variables like {{task}}, {{context}}
  defaultTools:   string[];
  llm:            { provider: string; model: string; temperature: number };
}
```

### Suggested initial catalog

| templateId | Purpose | Typical tools |
|-----------|---------|---------------|
| `data-analyst` | SQL, data analysis | `sql_query`, `export_csv` |
| `researcher` | Web search, synthesis | `web_search`, `system_vector_search` |
| `api-caller` | External APIs | tenant HTTP tools |
| `summarizer` | Long text summary | `system_get_memory` |
| `code-runner` | Run and validate code | `code_exec`, `test_runner` |
| `document-writer` | Structured documents | `drafting_tool`, `system_vector_search` |
| `validator` | Verify outputs | read-only tools |
| `notifier` | Notifications | `send_email`, `slack_message` |

### Tool `spawn_from_template`

```typescript
await Tool.define({
  id:          "spawn_from_template",
  scope:       "global",
  description: "Creates a sub-agent from a predefined template. Faster and more consistent than manual spawn_agent.",
  inputSchema: {
    type: "object",
    properties: {
      templateId: { type: "string", description: "Template id (see list_agent_templates)" },
      agentId:    { type: "string", description: "Unique instance id" },
      variables:  { type: "object", description: "Variables for the template (e.g. { task, context })" },
      input:      { type: "string", description: "First message to the sub-agent" },
    },
    required: ["templateId", "agentId", "input"],
  },
  execute: async ({ templateId, agentId, variables = {}, input }, context) => {
    const template = await store.methods.getAgentTemplate(templateId);
    if (!template) throw new Error(`Template '${templateId}' not found`);

    let systemPrompt = template.systemPrompt;
    for (const [key, value] of Object.entries(variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(`{{${key}}}`, "g"), String(value));
    }

    const runId = `run-${agentId}-${Date.now()}`;

    await store.Agent.define(context.session!.projectId, {
      id: agentId,
      projectId: context.session!.projectId,
      systemPrompt,
      tools: template.defaultTools,
      llm:   template.llm,
    });

    const job = await dispatchEngineJob(queue, {
      type:      "run",
      agentId,
      projectId: context.session!.projectId,
      sessionId: `spawned-${agentId}-${Date.now()}`,
      runId,
      input:     { type: "text", content: input },
    });

    return { jobId: job.id, runId, templateId };
  },
});
```

---

## 8. Security controls

### 8.1 Recursion depth limit

Prevents sub-agents from spawning arbitrarily deep trees. Carry depth in `sessionContext`.

```typescript
const depth = (context.session?.sessionContext as any)?.plannerDepth ?? 0;
if (depth >= 2) {
  throw new Error("plannerDepth limit reached. Sub-agents cannot create further agents.");
}

// When enqueueing the sub-agent job:
// sessionContext: { plannerDepth: depth + 1 }
```

### 8.2 Sub-agent cap per plan

```typescript
const activeJobs = await queue.getJobCounts("active", "waiting");
const MAX_CONCURRENT = 20;

if ((activeJobs.active + activeJobs.waiting) >= MAX_CONCURRENT) {
  throw new Error(`Limit of ${MAX_CONCURRENT} active sub-agents reached. Wait for some to finish.`);
}
```

### 8.3 Tool allowlist for sub-agents

The Planner must not assign tools that compromise the system:

```typescript
const FORBIDDEN_TOOLS_FOR_SUBAGENTS = new Set([
  "spawn_agent",
  "spawn_from_template",
  "system_vector_delete",
  // extend per deployment
]);

const forbidden = tools.filter(t => FORBIDDEN_TOOLS_FOR_SUBAGENTS.has(t));
if (forbidden.length > 0) {
  throw new Error(`Tools not allowed for sub-agents: ${forbidden.join(", ")}`);
}
```

### 8.4 Isolation via `projectId`

Sub-agents inherit the Planner’s `projectId`. Definitions live under that project so one tenant cannot reach another’s resources.

### 8.5 Cleanup of ephemeral definitions

Sub-agent definitions created by the Planner should be removed when the Planner run completes to avoid Redis bloat:

```typescript
worker.on("completed", async (job) => {
  if (job.data.agentId === "planner") {
    const spawnedIds = await runStore.getMetadata(job.data.runId, "spawnedAgents");
    for (const id of spawnedIds ?? []) {
      await store.Agent.delete(job.data.projectId, id);
    }
  }
});
```

---

## 9. Implementation roadmap

### Phase 1 — MVP

**Goal:** Working Planner with one level of sub-agents.

- [ ] `spawn_agent` with depth control
- [ ] `wait_for_agents` polling `RunStore`
- [ ] `list_available_tools`
- [ ] `list_available_models` with declarative catalog
- [ ] `planner` agent with baseline system prompt
- [ ] End-to-end test: simple goal → 2–3 parallel sub-agents → aggregated result
- [ ] Runnable example under `examples/autonomous-planner/`

**Success criteria:** The Planner splits “Analyze X and summarize Y” into two sub-agents, runs them in parallel, and merges the result.

---

### Phase 2 — Reflection and templates

**Goal:** Output quality and reuse.

- [ ] `reflect_and_retry`
- [ ] Template schema in Redis (`store.methods.getAgentTemplate`)
- [ ] `spawn_from_template` and `list_agent_templates`
- [ ] Initial catalog of 5–6 templates
- [ ] Human-in-the-loop: `wait` for expensive plans
- [ ] Metrics: tokens per plan, sub-agents created, success rate

**Success criteria:** The Planner uses templates, detects a weak output, and corrects it automatically.

---

### Phase 3 — Multi-level coordination

**Goal:** Complex plans with dependencies and peer coordination.

- [ ] Explicit multi-phase plans (phase 1 → 2 → 3)
- [ ] Sub-agents using `system_send_message` to coordinate
- [ ] Automatic cleanup of ephemeral definitions after a plan
- [ ] Plan dashboard: live sub-agent status
- [ ] Persist plan in `working` memory for failure recovery

**Success criteria:** A three-phase plan where phase-2 agents consume phase-1 outputs.

---

### Phase 4 — Learning and optimization (ongoing)

**Goal:** The Planner improves over time.

- [ ] `longTerm` memory: which plan shapes worked, which sub-agents failed
- [ ] Auto self-evaluation after plans complete
- [ ] Suggest new templates from usage patterns
- [ ] Tune Planner system prompt from `thought` logs

---

## 10. Production considerations

### Token cost

The Planner uses the strongest model (`claude-opus-4`), which is the most expensive. Each plan means multiple Planner turns plus all sub-agent tokens. Mitigations:

- Use `claude-sonnet-4` for simple sub-agents; keep opus for the Planner
- Cap Planner `maxTurns` for non-converging plans
- Record per-plan cost in metrics for anomaly detection
- Use `watchUsage(runBuilder, { projectId })` to track wasted tokens

### Observability

Each sub-agent has its own `runId` in `RunStore`. To trace a full plan:

```typescript
await runStore.setMetadata(plannerRunId, "spawnedRuns", [
  { agentId: "analyst-001", runId: "run-analyst-001" },
  { agentId: "writer-001",  runId: "run-writer-001"  },
]);
```

A dashboard can render the full execution tree.

### Timeouts by task type

Not all sub-agents take the same time. Tune `wait_for_agents` timeouts:

| Sub-agent type | Suggested timeout |
|----------------|-------------------|
| Simple SQL | 30s |
| Search + synthesis | 60s |
| Document generation | 120s |
| Data pipeline | 300s |

### Failure handling

The Planner should classify blocking vs non-blocking failures:

- **Blocking:** data extraction fails → plan cannot continue
- **Non-blocking:** chart generation fails → continue without charts and mention it in the final answer

Use `failOnAny: true` only for blocking dependency steps.

---

*Brainstorm derived from exploration of OpenCoreAgents Runtime — April 2026*
