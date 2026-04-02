# Definition syntax (core)

**Canonical** JSON shapes to configure the agent, invoke the engine, and parse LLM steps, plus **library syntax** (`Tool.define`, `Skill.define`, `Agent.define`, `Agent.load`). The protocol invariant is **discrimination by `type`** on each model turn.

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
    "model": "gpt-4",
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

Typical registration order (runtime persists to store — e.g. Redis/Upstash — and validates schemas):

```
Tool.define  →  Skill.define  →  Agent.define  →  Agent.load + run
```

The following objects are **conceptually equivalent** to the JSON in §1 and §8; `.define` methods serialize and version them in the store.

### 9.1 `Tool.define`

Registers a tool in the engine catalog (name exposed to the LLM + metadata + scope).

```typescript
import { Tool } from "@agent-runtime/core";

// Global tool (all projects)
await Tool.define({
  id: "save_memory",
  name: "Save memory",
  scope: "global",
  description: "Persists content in the agent's memory.",
  inputSchema: {
    type: "object",
    properties: {
      memoryType: { enum: ["shortTerm", "longTerm", "working"] },
      content: {},
    },
    required: ["memoryType", "content"],
  },
  outputSchema: { type: "object", properties: { success: { type: "boolean" } } },
  roles: ["admin", "agent"],
});

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
});
```

**Implementation note**: the **handler** (code that runs `execute`) is usually registered in the Node process under the same `id` as the persisted definition, or resolved via an internal adapter; the store document should not hold arbitrary code without a sandbox.

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
  llm: { provider: "openai", model: "gpt-4", temperature: 0.2 },
  security: { roles: ["operator", "admin"] },
});
```

### 9.4 `Agent.load` and execution

Instantiate an agent already defined in the store, with a **session** to scope memory/history.

```typescript
import { Agent, Session } from "@agent-runtime/core";

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

Resume after `wait`:

```typescript
await agent.resume(runId, { type: "text", content: "yes" }).then(...);
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
  execute?: (ctx: {
    input: unknown;
    context: Record<string, unknown>;
  }) => Promise<unknown>;
}

interface AgentDefinitionPersisted extends AgentDefinition {
  name?: string;
  projectId?: string;
  defaultMemory?: Record<string, unknown>;
  security?: { roles?: string[]; scopes?: string[] };
}
```

---

## Global convention

- LLM output: **one JSON object per turn**, always with `type`.
- Unknown fields: the engine may ignore or reject the step per versioning policy.
