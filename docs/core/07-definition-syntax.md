# Definition syntax (core)

**Canonical** JSON shapes to configure the agent, invoke the engine, and parse LLM steps, plus **library syntax** (`Tool.define`, `Skill.define`, `Agent.define`, `Agent.load`). The protocol invariant is **discrimination by `type`** on each model turn.

Related: [19-cluster-deployment.md §2](./19-cluster-deployment.md) (bootstrap — **`AgentRuntime`**, built-in tools, `runStore`), [03-execution-model.md](./03-execution-model.md) (wait / resume).

---

## 1. Agent definition (`Agent`)

**Static** object the engine loads when starting a run (from code, file, or external store).

```json
{
  "id": "ops-analyst",
  "systemPrompt": "You triage operational intake; respond with only one JSON step object per turn.",
  "skills": ["intakeSummary"],
  "tools": ["system_save_memory", "system_get_memory"],
  "memoryConfig": {
    "shortTerm": { "maxTurns": 10 },
    "longTerm": true,
    "working": {}
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.2
  }
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Stable agent identifier. |
| `systemPrompt` | yes | Base instructions + step output format. |
| `skills` | no | List of ids resolved by the Skills module. |
| `tools` | no | Allowlist of names registered in ToolRunner. |
| `memoryConfig` | no | Policy for Context Builder and memory tools. |
| `llm` | yes* | *Required if the engine calls the adapter unless **`AgentRuntime`** supplies a matching adapter via **`llmAdapter`** / **`llmAdaptersByProvider`** — see [19-cluster-deployment.md §2](./19-cluster-deployment.md). |

---

## 2. Input: execute run (`RunInput`)

First call to the engine (HTTP / internal SDK equivalent).

```json
{
  "agentId": "ops-analyst",
  "sessionId": "optional-session-scope",
  "input": {
    "type": "text",
    "content": "Ticket #4412: refund still pending after 5 business days"
  },
  "context": {
    "timestamp": "2026-04-02T12:00:00Z",
    "source": "manual | webhook | cron | api"
  }
}
```

- `sessionId`: optional; if present, Context Builder / memory may scope by session.

---

## 3. Input: resume (`ResumeInput`)

When the run ended in `waiting`.

```json
{
  "runId": "run-uuid",
  "agentId": "ops-analyst",
  "input": {
    "type": "text",
    "content": "yes"
  }
}
```

---

## 4. Run record (`Run`)

Persisted or in-memory state for one execution cycle.

```json
{
  "runId": "uuid",
  "agentId": "ops-analyst",
  "sessionId": "optional",
  "status": "running | waiting | completed | failed",
  "history": [],
  "state": {
    "iteration": 0,
    "pending": null
  }
}
```

- `history`: array of **protocol messages** (§6).
- `state.pending`: when `status === "waiting"`, typically `{ "reason": "user_input", "details": {} }`.

---

## 5. LLM-emitted step (`Step`)

One JSON object per model invocation (the engine parses and branches). **Discriminated union** by `type`:

Validation, errors, and re-prompt when JSON is invalid: [13-errors-parsing-and-recovery.md](./13-errors-parsing-and-recovery.md).

### 5.1 `thought`

```json
{
  "type": "thought",
  "content": "SLA at risk; customer tier enterprise — likely needs escalation."
}
```

### 5.2 `action`

```json
{
  "type": "action",
  "tool": "system_save_memory",
  "input": {
    "memoryType": "longTerm",
    "content": { "event": "sla_at_risk" }
  }
}
```

- `tool` must exist in the registry and be **allowed** for the agent.

### 5.3 `wait`

```json
{
  "type": "wait",
  "reason": "user_input | external_event | scheduled",
  "details": {
    "question": "Confirm escalation to L2?"
  }
}
```

### 5.4 `result`

```json
{
  "type": "result",
  "content": "Recommend L2 handoff within 15 minutes and notify billing."
}
```

On `result`, the engine marks `completed` (after appending to history).

---

## 6. History message (`ProtocolMessage`)

What is **appended** to `run.history` (may include engine metadata).

```json
{
  "type": "thought | action | observation | wait | result",
  "content": {},
  "meta": {
    "ts": "ISO-8601",
    "source": "llm | engine | tool"
  }
}
```

- For `action`, `content` may be the pair `{ "tool", "input" }` or a serialized string; **consistency** in your implementation matters.
- `observation`: `content` is often `{ "success": true, "data": ... }` or the raw tool return value.

---

## 7. Trace envelope (`RunEnvelope`)

Aggregated view for logs or inspection API.

```json
{
  "id": "uuid",
  "agentId": "ops-analyst",
  "sessionId": "optional",
  "messages": [],
  "state": {},
  "toolNames": ["system_save_memory", "system_get_memory"],
  "status": "running | waiting | completed | failed"
}
```

---

## 8. Tool definition (engine registry)

What **ToolRunner** needs; not the same as the LLM’s `action` step. The canonical key in code is **`id`** (matches `action.tool` in §5.2). Optional **`name`** is a display label only.

```json
{
  "id": "system_save_memory",
  "description": "Persists a fragment in the agent's memory.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "memoryType": { "enum": ["shortTerm", "longTerm", "working"] },
      "content": {}
    },
    "required": ["memoryType", "content"]
  }
}
```

- `inputSchema` is optional but recommended to **document** the tool for the model and for validation.

---

## 9. Library: `.define` syntax and loading

Typical registration order:

```
new AgentRuntime({ ... })  →  Tool.define (custom)  →  Skill.define  →  Agent.define  →  Agent.load(id, runtime, { session }) + run
```

Construct **`AgentRuntime`** once per worker (or process) before **`Agent.load`**. Its constructor registers **built-in** memory tools **`system_save_memory`** and **`system_get_memory`**; with **`embeddingAdapter`** and **`vectorAdapter`**, also **`system_vector_search`**, **`system_vector_upsert`**, and **`system_vector_delete`**; with **`messageBus`**, **`system_send_message`**. **`@opencoreagents/rag`** (e.g. **`registerRagToolsAndSkills()`**) adds catalog and file tools with the same **`system_`** prefix: **`system_list_rag_sources`**, **`system_ingest_rag_source`**, **`system_file_read`**, **`system_file_ingest`**, **`system_file_list`**. You do **not** `Tool.define` these unless you are replacing defaults (advanced).

### 9.0 `system_*` tool ids (reference)

| Package | Constants | Ids |
|---------|-----------|-----|
| **`@opencoreagents/core`** | **`CORE_SYSTEM_TOOL_IDS`**, **`isCoreSystemToolId()`** | **`system_save_memory`**, **`system_get_memory`**, **`system_vector_search`**, **`system_vector_upsert`**, **`system_vector_delete`**, **`system_send_message`** |
| **`@opencoreagents/rag`** | **`RAG_SYSTEM_TOOL_IDS`**, **`isRagSystemToolId()`** | **`system_list_rag_sources`**, **`system_ingest_rag_source`**, **`system_file_read`**, **`system_file_ingest`**, **`system_file_list`** |

Handlers for vector and messaging tools are registered only when the corresponding **`AgentRuntime`** options are set; the id list is still stable for allowlists and prompts.

The following objects are **conceptually equivalent** to the JSON in §1 and §8; `.define` persists definitions into the in-process registry. Your app may also load **serializable** metadata from Redis/Postgres and call **`Skill.define(def, execute?)`** or **`Skill.defineBatch`** so each worker hydrates the same local `Map`s — see §9.2b.

### 9.1 `Tool.define`

Registers a **custom** tool in the engine catalog (name exposed to the LLM + metadata + scope). Pass **`execute`** so the handler is registered in the same call.

```typescript
import { Tool } from "@opencoreagents/core";

// Example: global custom tool (all projects)
await Tool.define({
  id: "lookup_ticket",
  scope: "global",
  description: "Loads a support ticket by id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  roles: ["agent"],
  execute: async (input) => ({ ticket: { id: (input as { id: string }).id, status: "open" } }),
});

// Built-ins: memory + vector + messaging from AgentRuntime; RAG/file tools from @opencoreagents/rag — all `system_*` ids; shapes in §8 / 17-rag-pipeline.md; not re-defined here unless you replace defaults.

// Project-scoped tool (multi-tenant)
await Tool.define({
  id: "upstash_trigger",
  name: "Upstash workflow trigger",
  projectId: "acme-corp",
  description: "Triggers a serverless flow and returns status.",
  inputSchema: {
    type: "object",
    properties: {
      flowId: { type: "string" },
      sessionId: { type: "string" },
      params: { type: "object" },
    },
    required: ["flowId"],
  },
  roles: ["admin", "agent"],
  execute: async (input) => ({ triggered: true, flowId: (input as { flowId: string }).flowId }),
});
```

**Implementation note**: with `Tool.define({ ..., execute })`, the handler is registered in-process under `def.id`. Without `execute`, only the definition is stored — the engine still needs a matching **`registerToolHandler`** (or **`registerToolDefinition`** + **`registerToolHandler`**) from your bootstrap. For **JSON-only HTTP integrations**, use **`@opencoreagents/adapters-http-tool`** and **`registerHttpToolsFromDefinitions`** — [20-http-tool-adapter.md](./20-http-tool-adapter.md).

### 9.2 `Skill.define`

Registers a reusable skill that references tools by `id`. In **TypeScript source**, put **`execute` on `def`** when the skill has imperative logic. The optional **second argument** exists only for **§9.2b** (JSON from Redis/DB): it attaches `execute` when the parsed row cannot carry a function. If `def` already includes `execute`, the second argument is **ignored**.

```typescript
import { Skill } from "@opencoreagents/core";

await Skill.define({
  id: "intakeSummary",
  name: "Intake summary",
  scope: "global",
  tools: ["system_save_memory"],
  description: "Summarizes intake context and may persist notes.",
  roles: ["agent"],
});

await Skill.define({
  id: "workflowHandoff",
  name: "Workflow handoff",
  projectId: "acme-corp",
  tools: ["system_save_memory", "upstash_trigger"],
  roles: ["operator", "analyst"],
});
```

If the skill includes versioned **imperative** logic, define **`execute` on the object** (do not split it into a second argument in app code — that form is for §9.2b only):

```typescript
await Skill.define({
  id: "workflowHandoff",
  projectId: "acme-corp",
  tools: ["system_save_memory", "upstash_trigger"],
  execute: async ({ input, context }) => {
    // delegate to engine / LLM / tools per runtime policy
    return { suggestedPriority: "high" };
  },
  roles: ["operator"],
});
```

`execute` is **optional**: a skill can be only tool grouping + description / prompt shaping, with no imperative handler.

### 9.2b Skills from an external store (hybrid)

Use type **`SkillDefinitionPersisted`** (`SkillDefinition` minus `execute`) as the JSON shape in Redis/Postgres. After `JSON.parse`, call **`Skill.define(row, skillExecutes[row.id])`** — omit the second argument for declarative-only skills — or **`Skill.defineBatch(rows, skillExecutes)`** where `skillExecutes` is `Partial<Record<string, SkillExecute>>` (only ids with imperative logic need an entry).

Same **`Skill.define`** entry point as §9.2; the second argument is only meaningful when `def` has no `execute` (typical for parsed JSON).

```typescript
import {
  Skill,
  type SkillDefinitionPersisted,
  type SkillExecute,
} from "@opencoreagents/core";

const skillExecutes: Partial<Record<string, SkillExecute>> = {
  workflowHandoff: async ({ input, context }) => ({ suggestedPriority: "high" }),
};

const persisted = JSON.parse(
  (await redis.get("skill:acme:workflowHandoff"))!,
) as SkillDefinitionPersisted;
await Skill.define(persisted, skillExecutes[persisted.id]);

const list = JSON.parse((await redis.get("skills:acme"))!) as SkillDefinitionPersisted[];
await Skill.defineBatch(list, skillExecutes);
```

Validate or schema-check parsed JSON in production before registering; `as SkillDefinitionPersisted` is only for the type checker.

**Cluster**: each worker registers locally after reading the same data (boot or pub/sub). No Redis client in `@opencoreagents/core` — see [19-cluster-deployment.md](./19-cluster-deployment.md) §1.1.

### 9.3 `Agent.define`

Persists the agent definition aligned with §1 (`systemPrompt`, `tools`, `skills`, `memoryConfig`, `llm`).

```typescript
import { Agent } from "@opencoreagents/core";

await Agent.define({
  id: "ops-analyst",
  name: "Ops analyst",
  projectId: "acme-corp",
  systemPrompt:
    "You triage operational intake; each turn respond with a single JSON Step object (type thought|action|wait|result).",
  skills: ["intakeSummary", "workflowHandoff"],
  tools: ["system_save_memory", "system_get_memory", "upstash_trigger"],
  memoryConfig: {
    shortTerm: { maxTurns: 10 },
    longTerm: true,
    working: {},
  },
  defaultMemory: { notes: [] },
  llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
  security: { roles: ["operator", "admin"] },
});
```

### 9.4 `Agent.load` and execution

Instantiate an agent already defined in the store, with a **session** to scope memory/history.

```typescript
import { Agent, AgentRuntime, Session } from "@opencoreagents/core";

const runtime = new AgentRuntime({
  // llmAdapter, memoryAdapter, runStore?, …
});

// Internal / operator use — no end-user
const session = new Session({
  id: "queue-east-2026-04-02",
  projectId: "acme-corp",
});

const agent = await Agent.load("ops-analyst", runtime, { session });

await agent
  .run("Ticket #4412: refund still pending after 5 business days")
  .onThought((t) => console.debug("thought", t))
  .onAction((a) => console.debug("action", a))
  .onObservation((o) => console.debug("observation", o))
  .onWait(async (w) => {
    if (w.reason === "user_input") return "yes";
    return undefined;
  })
  .then((result) => console.log("done", result))
  .catch((err) => console.error(err));
```

**`onWait`**: if the callback returns a **string**, the engine **continues the same run in-process** (equivalent to `resume` with `type: "text"`). If it returns **`undefined`**, the run stays **`waiting`** — use **`agent.resume(runId, input)`** (requires **`runStore`** on **`AgentRuntime`** for cross-worker resume; see [19-cluster-deployment.md §3](./19-cluster-deployment.md)).

End-user facing session (B2B2C — e.g. support bot):

```typescript
import { Agent, AgentRuntime, Session } from "@opencoreagents/core";

const runtime = new AgentRuntime({
  // llmAdapter, memoryAdapter, …
});
const session = new Session({
  id: "customer-456:conv-20260407-001",
  projectId: "acme-support",
  endUserId: "customer-456",
});

const agent = await Agent.load("support-bot", runtime, { session });
await agent.run("My order #8812 hasn't arrived");
```

When `endUserId` is present, the MemoryAdapter scopes `longTerm` and `vectorMemory` by `endUserId` instead of `sessionId`, enabling persistence across conversations. See [15-multi-tenancy.md §4](./15-multi-tenancy.md).

Resume after `wait` (requires `runStore` on **`AgentRuntime`**; loads persisted `Run`, injects resume message, continues the loop):

```typescript
await agent.resume(runId, { type: "text", content: "yes" }).then(...);
```

**Custom orchestration (queue workers, HTTP handlers)** — same loop as `RunBuilder`, without the fluent API: **`buildEngineDeps(agent, session, runtime)`** → **`createRun`** → **`executeRun`** with **`startedAtMs`** (and **`resumeMessages`** after a `wait`). If you bypass `Agent.resume`, persist **`waiting`** runs via **`runStore`** yourself. See [14-consumers.md](./14-consumers.md) and [19-cluster-deployment.md](./19-cluster-deployment.md).

```typescript
import {
  AgentRuntime,
  buildEngineDeps,
  createRun,
  executeRun,
  getAgentDefinition,
} from "@opencoreagents/core";

const runtime = new AgentRuntime({
  // llmAdapter, memoryAdapter, runStore?, …
});
const agent = getAgentDefinition("acme-corp", "ops-analyst")!;
const base = buildEngineDeps(agent, session, runtime);
const run = createRun(agent.id, session.id, "user text", session.projectId);

await executeRun(run, { ...base, startedAtMs: Date.now() });
```

### 9.5 `scope` / `projectId` resolution

| Field | Effect |
|-------|--------|
| `scope: "global"` | Tool/skill visible across projects (if SecurityLayer allows). |
| `projectId: "..."` | Isolated namespace; `Agent.load` must use the same session/project. |

When resolving references, the runtime usually searches **project first**, then **global**.

Full scope (session, run, store keys) and **SecurityLayer**: [08-scope-and-security.md](./08-scope-and-security.md).

---

## 10. TypeScript types (reference)

```typescript
type RunStatus = "running" | "waiting" | "completed" | "failed";

type Step =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; input: unknown }
  | { type: "wait"; reason: string; details?: unknown }
  | { type: "result"; content: string };

interface AgentDefinition {
  id: string;
  systemPrompt: string;
  skills?: string[];
  tools?: string[];
  memoryConfig?: Record<string, unknown>;
  llm?: { provider: string; model: string; [key: string]: unknown };
}

/** Payload persisted via Tool.define */
interface ToolDefinition {
  id: string;
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scope?: "global";
  projectId?: string;
  roles?: string[];
}

interface SkillDefinition {
  id: string;
  name?: string;
  scope?: "global";
  projectId?: string;
  tools: string[];
  description?: string;
  roles?: string[];
  execute?: SkillExecute;
}

/** JSON-safe skill row for Redis/DB; register with `Skill.define(row, skillExecutes[row.id])`. */
type SkillDefinitionPersisted = Omit<SkillDefinition, "execute">;

type SkillExecute = (args: {
  input: unknown;
  context: {
    agentId: string;
    runId: string;
    memory: MemoryAdapter;
    invokeTool: (name: string, input: unknown) => Promise<unknown>;
  };
}) => Promise<unknown>;

interface AgentDefinitionPersisted extends AgentDefinition {
  name?: string;
  projectId?: string;
  defaultMemory?: Record<string, unknown>;
  security?: { roles?: string[]; scopes?: string[] };
}

/** Session scoping for Agent.load */
interface SessionOptions {
  id: string;
  projectId: string;
  endUserId?: string;
  expiresAtMs?: number;
}

/** Injected by SecurityLayer before the engine runs */
interface SecurityContext {
  principalId: string;
  kind: "user" | "service" | "end_user" | "internal";
  organizationId: string;
  projectId: string;
  endUserId?: string;
  roles: string[];
  scopes: string[];
}
```

Detail on `SecurityContext` fields and principal kinds: [08-scope-and-security.md](./08-scope-and-security.md). Full multi-tenancy model: [15-multi-tenancy.md](./15-multi-tenancy.md).

---

## Global convention

- LLM output: **one JSON object per turn**, always with `type`.
- Unknown fields: the engine may ignore or reject the step per versioning policy.
