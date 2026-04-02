# PRD Overview: Agent Runtime Node.js

**Multi-Agent + CLI MCP + REST API + Sessions Scope + Security Layer + Upstash (Redis & Vector) + Agent.define()**

Project synthesis document. Not final technical specification — see `docs/core/` for implementation contracts.

---

## 1. Purpose

Build a Node.js agent runtime that enables:

- Stateful agents with layered configurable memory and skills
- Native, secure communication between agents via MessageBus
- Execution loop with states `running | waiting | completed | failed`
- Bluebird-style Promise API with hooks (`onThought`, `onAction`, `onObservation`, `onWait`)
- CLI for local execution and monitoring (MCP-compatible)
- REST API for remote interaction with authentication
- Session scope for isolated contexts per user or business cycle
- Security Layer for access control, roles, and scopes per project
- Upstash integration: Redis (memory/definitions), Vector DB (semantic memory); **BullMQ** as primary job-queue adapter for async runs and scheduled `wait/resume`; **QStash** as alternative (HTTP callbacks)
- Dynamic agent definition with `Agent.define()` — no redeploy
- Architecture decoupled from LLM vendor (OpenAI, Anthropic, etc.)

---

## 2. Key components

| Component | Role |
|-----------|------|
| **Agent** | Identity, memory, skills, tools, communication configuration |
| **Agent.define()** | Defines and registers agents dynamically in Redis/DB with ID, tools, skills, initial memory, and security rules |
| **AgentExecution** | Loop, states, action and wait coordination, session management |
| **Session** | Temporal execution context: memory and logs isolated by `sessionId` |
| **MemoryAdapter** | Memory persistence per agent and session — in-memory, Redis, Upstash Vector |
| **ToolAdapter** | Executes external actions and returns observations to history |
| **UpstashAdapter** | Upstash flows + Redis + Vector DB, triggers and event-driven pipelines |
| **MessageBus** | Secure communication between agents within the same `projectId` |
| **LLMAdapter** | Multi-provider LLM connection — OpenAI, Anthropic, etc. |
| **SecurityLayer** | Authentication, authorization, input validation, scope control |
| **CLI** | Run and monitor agents locally, with sessions and security; MCP-compatible |
| **REST API** | Remote interaction, agent and session control with authentication |

---

## 3. Agent.define() — concept

Create agents dynamically at runtime:

- Configuration persists in Redis or DB — not only in code
- Includes ID/slug, tools, skills, initial memory, and security rules
- Compatible with multiple parallel sessions
- Any process (SDK, CLI, REST) can `Agent.load("id")` without redeploy

### Usage example

```typescript
import { Tool, Skill, Agent, Session } from "@agent-runtime/core";

// 1. Register tools
await Tool.define({
  id: "save_memory",
  scope: "global",
  description: "Persists a fragment in the agent's memory.",
  inputSchema: { /* ... */ },
});

// 2. Register skill
await Skill.define({
  id: "intakeSummary",
  projectId: "acme-corp",
  tools: ["save_memory", "get_memory"],
  description: "Summarizes intake and persists notes.",
});

// 3. Define agent — persists to DB
await Agent.define({
  id: "ops-analyst",
  name: "Ops analyst",
  projectId: "acme-corp",
  description: "Triage tickets and operational tasks.",
  systemPrompt: "You triage operational intake. Respond with one JSON Step per turn.",
  skills: ["intakeSummary"],
  tools: ["save_memory", "get_memory"],
  defaultMemory: { notes: [] },
  llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
  security: { roles: ["operator", "admin"] },
});
// ✓ Saved to DB. No redeploy.

// 4. Instantiate and run
const session = new Session({ id: "queue-2026-04-01", projectId: "acme-corp" });
const agent = await Agent.load("ops-analyst", { session });

await agent
  .run("Ticket #4412: refund still pending — what should we do next?")
  .onThought((t) => console.debug("[thought]", t.content))
  .onAction((a) => console.debug("[action]", a.tool))
  .onWait(async (w) => {
    if (w.reason === "user_input") return prompt(w.details.question);
  })
  .then((r) => console.log("[result]", r.content));

// 5. Resume after a wait
await agent.resume(runId, { type: "text", content: "approved — escalate to billing" });
```

---

## 4. Upstash integration

| Adapter / service | Role in the runtime |
|-------------------|---------------------|
| **Upstash Redis** | `MemoryAdapter` for `longTerm` and `working`; store for definitions (agents, tools, skills); run history |
| **Upstash Vector** | `MemoryAdapter` for `vectorMemory` — semantic search over relevant memory |
| **BullMQ (primary)** | Redis job queues — **first implementation** for async `run`/`resume`, scheduled `wait`, optional MessageBus; workers call the same engine entry points as SDK/REST ([`core/05-adapters.md`](../core/05-adapters.md#job-queue-adapter-primary-bullmq)) |
| **Upstash QStash (alternative)** | HTTP callback to `POST /runs/:id/resume` when BullMQ workers are not used — same wake semantics, serverless-oriented |

```typescript
import { UpstashMemoryAdapter } from "@agent-runtime/adapters-upstash";

const memory = new UpstashMemoryAdapter({
  redis: { url: process.env.UPSTASH_REDIS_URL, token: process.env.UPSTASH_REDIS_TOKEN },
  vector: { url: process.env.UPSTASH_VECTOR_URL, token: process.env.UPSTASH_VECTOR_TOKEN },
});

const agent = await Agent.load("ops-analyst", { session, memory });
```

---

## 5. CLI (MCP-compatible)

```bash
# Run an agent
agent-cli run ops-analyst --session queue-today --input "Ticket #4412 still pending — next step?"

# Resume after wait
agent-cli resume <runId> --input "approved — escalate to billing"

# Inspect run history
agent-cli logs <runId>

# View agent memory for a session
agent-cli memory ops-analyst --session queue-today

# Send message between agents
agent-cli send ops-analyst policy-checker --message '{"type":"request","task":"check refund policy"}'
```

---

## 6. REST API

```http
POST   /agents/:id/run          # Start run
POST   /runs/:runId/resume      # Resume waiting run
GET    /runs/:runId             # Run status and history
GET    /agents/:id/memory       # Agent memory
POST   /agents                  # Agent.define() over HTTP
POST   /agents/:id/send         # Send message to another agent
```

All routes pass through SecurityLayer before reaching the engine.

---

## 7. Benefits

- **No redeploy**: create or change agents from code, CLI, or REST — config lives in DB
- **Native multi-tenant**: `projectId` isolates definitions, memory, and communication
- **Full traceability**: append-only history per `runId` — reproducible and auditable
- **Real pauses**: `wait/resume` as a primitive — no hand-rolled state machines
- **Swappable adapters**: in-memory in dev, Upstash in production — same engine
- **Secure multi-agent**: MessageBus per project, no cross-tenant leakage

---

## 8. Operational best practices

- Validate `inputSchema` on every `Tool.define` — ToolRunner rejects malformed inputs before execute
- Set `security.roles` on agents that touch sensitive data or destructive tools
- Cap `maxIterations` in the engine from the start — prevents infinite loops and surprise cost
- Redis key namespacing: keys follow `{projectId}:{agentId}:{sessionId}:*` — do not mix tenants
- Version agent definitions: store `version` in `Agent.define` to avoid conflicts with active runs
- TTL on session memory: clear `shortTerm` and `working` after the session to avoid Redis bloat
- Centralized logs by `runId` and `agentId` for audit — `onAction` / `onObservation` hooks are the natural place
- Do not keep embeddings forever in Upstash Vector — clean up by `sessionId` or age

---

## Technical references

| Doc | Topic |
|-----|-------|
| [`core/03-execution-model.md`](../core/03-execution-model.md) | Loop, Run entity, wait/resume |
| [`core/05-adapters.md`](../core/05-adapters.md) | MemoryAdapter and ToolAdapter contracts |
| [`core/06-mvp.md`](../core/06-mvp.md) | MVP scope and Upstash integration |
| [`core/07-definition-syntax.md`](../core/07-definition-syntax.md) | Full define/load/run shapes |
| [`core/08-scope-and-security.md`](../core/08-scope-and-security.md) | SecurityLayer and multi-tenant scopes |
| [`core/09-communication-multiagent.md`](../core/09-communication-multiagent.md) | MessageBus and request-reply patterns |
| [`core/14-consumers.md`](../core/14-consumers.md) | SDK, CLI, REST, MCP, webhooks, cron |
