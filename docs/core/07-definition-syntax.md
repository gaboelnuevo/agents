# Definition syntax (core)

**Canonical** JSON shapes to configure the agent, invoke the engine, and parse LLM steps, plus **library syntax** (`Tool.define`, `Skill.define`, `Agent.define`, `Agent.load`). The protocol invariant is **discrimination by `type`** on each model turn.

Related: [19-cluster-deployment.md §2](./19-cluster-deployment.md) (bootstrap — `configureRuntime`, built-in tools, `runStore`), [03-execution-model.md](./03-execution-model.md) (wait / resume).

---

## 1. Agent definition (`Agent`)

**Static** object the engine loads when starting a run (from code, file, or external store).

```json
{
  "id": "ops-analyst",
  "systemPrompt": "You triage operational intake; respond with only one JSON step object per turn.",
  "skills": ["intakeSummary"],
  "tools": ["save_memory", "get_memory"],
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
| `llm` | yes* | *Required if the engine calls the adapter; may default globally. |

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
  "tool": "save_memory",
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
  "toolNames": ["save_memory", "get_memory"],
  "status": "running | waiting | completed | failed"
}
```

---

## 8. Tool definition (engine registry)

What **ToolRunner** needs; not the same as the LLM’s `action` step.

```json
{
  "name": "save_memory",
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
configureRuntime({ ... })  →  Tool.define (custom)  →  Skill.define  →  Agent.define  →  Agent.load + run
```

Call **`configureRuntime`** once per process before `Agent.load`. It registers **built-in** tool handlers (`save_memory`, `get_memory`) and optionally vector / `send_message` handlers when the corresponding adapters are passed — you do **not** `Tool.define` those unless you are replacing defaults (advanced).

The following objects are **conceptually equivalent** to the JSON in §1 and §8; `.define` persists definitions into the in-process registry (not an external document store unless your app adds one).

### 9.1 `Tool.define`

Registers a **custom** tool in the engine catalog (name exposed to the LLM + metadata + scope). Pass **`execute`** so the handler is registered in the same call.

```typescript
import { Tool } from "@agent-runtime/core";

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

// Built-ins: `save_memory` / `get_memory` match the shapes in §8 — registered by configureRuntime, not re-defined here.

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

**Implementation note**: with `Tool.define({ ..., execute })`, the handler is registered in-process under `def.id`. Without `execute`, only the definition is stored — the engine still needs a matching `registerToolHandler` from your bootstrap (unusual for app code).

### 9.2 `Skill.define`

Registers a reusable skill that references tools by `id`.

```typescript
import { Skill } from "@agent-runtime/core";

await Skill.define({
  id: "intakeSummary",
  name: "Intake summary",
  scope: "global",
  tools: ["save_memory"],
  description: "Summarizes intake context and may persist notes.",
  roles: ["agent"],
});

await Skill.define({
  id: "workflowHandoff",
  name: "Workflow handoff",
  projectId: "acme-corp",
  tools: ["save_memory", "upstash_trigger"],
  roles: ["operator", "analyst"],
});
```

If the skill includes versioned **imperative** logic:

```typescript
await Skill.define({
  id: "workflowHandoff",
  projectId: "acme-corp",
  tools: ["LLMAdapter", "upstash_trigger"],
  execute: async ({ input, context }) => {
    // delegate to engine / LLM / tools per runtime policy
    return { suggestedPriority: "high" };
  },
  roles: ["operator"],
});
```

(`execute` is optional by design: skill as tool grouping + prompt template only.)

### 9.3 `Agent.define`

Persists the agent definition aligned with §1 (`systemPrompt`, `tools`, `skills`, `memoryConfig`, `llm`).

```typescript
import { Agent } from "@agent-runtime/core";

await Agent.define({
  id: "ops-analyst",
  name: "Ops analyst",
  projectId: "acme-corp",
  systemPrompt:
    "You triage operational intake; each turn respond with a single JSON Step object (type thought|action|wait|result).",
  skills: ["intakeSummary", "workflowHandoff"],
  tools: ["save_memory", "get_memory", "upstash_trigger"],
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
import { Agent, Session } from "@agent-runtime/core";

// Internal / operator use — no end-user
const session = new Session({
  id: "queue-east-2026-04-02",
  projectId: "acme-corp",
});

const agent = await Agent.load("ops-analyst", { session });

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

**`onWait`**: if the callback returns a **string**, the engine **continues the same run in-process** (equivalent to `resume` with `type: "text"`). If it returns **`undefined`**, the run stays **`waiting`** — use **`agent.resume(runId, input)`** (requires **`configureRuntime({ runStore })`** for cross-worker resume; see [19-cluster-deployment.md §3](./19-cluster-deployment.md)).

End-user facing session (B2B2C — e.g. support bot):

```typescript
const session = new Session({
  id: "customer-456:conv-20260407-001",
  projectId: "acme-support",
  endUserId: "customer-456",
});

const agent = await Agent.load("support-bot", { session });
await agent.run("My order #8812 hasn't arrived");
```

When `endUserId` is present, the MemoryAdapter scopes `longTerm` and `vectorMemory` by `endUserId` instead of `sessionId`, enabling persistence across conversations. See [15-multi-tenancy.md §4](./15-multi-tenancy.md).

Resume after `wait` (requires `runStore` in `configureRuntime`; loads persisted `Run`, injects resume message, continues the loop):

```typescript
await agent.resume(runId, { type: "text", content: "yes" }).then(...);
```

**Custom orchestration (queue workers, HTTP handlers)** — same loop as `RunBuilder`, without the fluent API: **`buildEngineDeps(agent, session)`** → **`createRun`** → **`executeRun`** with **`startedAtMs`** (and **`resumeMessages`** after a `wait`). If you bypass `Agent.resume`, persist **`waiting`** runs via **`runStore`** yourself. See [14-consumers.md](./14-consumers.md) and [19-cluster-deployment.md](./19-cluster-deployment.md).

```typescript
import {
  buildEngineDeps,
  createRun,
  executeRun,
  getAgentDefinition,
} from "@agent-runtime/core";

const agent = getAgentDefinition("acme-corp", "ops-analyst")!;
const base = buildEngineDeps(agent, session);
const run = createRun(agent.id, session.id, "user text");

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
