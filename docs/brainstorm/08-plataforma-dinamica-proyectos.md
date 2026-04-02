# Dynamic platform: define, projects, and global scope

Avoid agents “burned into” code: **runtime** definition persisted (Redis/DB) with **id/slug**, plus **per-project** isolation and **global** shared resources.

## Agent.define

### Idea

Register an agent from Node or REST; configuration is stored durably.

### Conceptual fields

- `id` / `slug`, name, description.
- Referenced tools and skills.
- Optional initial memory.
- Security: roles, scopes.

### Conceptual usage

```javascript
await Agent.define({
  id: "workflow-agent",
  name: "Workflow agent",
  tools: ["LLMAdapter", "UpstashAdapter"],
  skills: ["summarizeIntake", "generateReport"],
  defaultMemory: { notes: [] },
  security: { roles: ["operator", "admin"] }
});

const session = new Session("queue-2026-04-01");
const bot = await Agent.load("workflow-agent", session);
await bot.run("Summarize today’s open items for the East region");
```

### CLI / REST

```bash
agent-cli define --id workflow-agent --tools LLM,Upstash --skills summarizeIntake,...
```

```http
POST /agents/define
```

```json
{
  "id": "workflow-agent",
  "tools": ["LLMAdapter", "UpstashAdapter"],
  "skills": ["summarizeIntake", "generateReport"],
  "defaultMemory": { "notes": [] },
  "security": { "roles": ["operator", "admin"] }
}
```

## Tool.define and Skill.define

### Tool.define

Registers tools with input/output schema and roles; e.g. adapters to external flows, HTTP, etc.

### Skill.define

Registers skills that **use** tools; they can be versioned and reused across agents.

### Composition order

```
Tool.define → Skill.define → Agent.define → SessionScope → AgentExecution
```

Everything still goes through SecurityLayer, MessageBus (if applicable), and memory policy.

### Additional REST (evolving)

| Method | Endpoint |
|--------|----------|
| POST | `/tools/define` |
| POST | `/skills/define` |

---

## Per-project isolation (multi-tenant)

- Each **project** has a namespace in Redis/vector/MessageBus.
- Agents, tools, and skills are created and run under `projectId`.
- Memory and logs tied to `projectId` + `sessionId`.

### Benefits

- No cross-customer or cross-experiment leakage.
- Permissions and audit per project.
- Independent versioning per project.

---

## Global vs project scope

| Scope | Use |
|-------|-----|
| **Global** | Universal tools/skills (e.g. `LLMAdapter`, common utilities). No `projectId` or `scope: "global"`. |
| **Project** | Client- or domain-specific logic; with `projectId`. |

### Resolution

When executing a skill, the runtime can resolve **project** resources first, then **global**, avoiding duplicate common pieces.

---

## Implications of Agent.define (and dynamic definitions in general)

### Positives

- Scalability: many agents without redeploy.
- Flexibility: change config in storage.
- Recovery after process restarts.
- Audit and traceability if everything is versioned/logged.

### Risks

- Validation and security (schemas, roles, limits).
- Pressure on Redis/vector with many concurrent agents.
- Harder debugging if everything mutates at runtime.
- Inconsistency if agent config changes while sessions are active.

### Mitigations suggested in the document

- JSON Schema / strict validation.
- Limit of dynamic agents per session or cluster.
- Monitoring and GC of old memory/embeddings.
- **Versioning** of agent definitions.
- Centralized logs per agent and session.

---

## Consolidated document (final PDF vision)

The thread unifies:

- Stateful multi-agent runtime.
- Bluebird-style hooks.
- MCP-style CLI + REST API + sessions.
- SecurityLayer (token, scopes).
- Upstash integration (flows, Redis, vector) where applicable.
- `Agent.define` / `Tool.define` / `Skill.define` with **global** and **project**.

### Four-phase roadmap (summary)

1. Core engine, Memory/Tool adapters, MessageBus, basic CLI.
2. Multi-provider LLM, sessions, Redis/vector, dynamic definitions.
3. REST, SecurityLayer, full Upstash, audit.
4. Global vs project, multi-tenant isolation, versioning.

---

## Conceptual diagram (text)

```
REST / CLI → SecurityLayer → Agent|Tool|Skill.define (store)
          → SessionScope → AgentExecution → MemoryAdapter / ToolAdapter
          → MessageBus (multi-agent) → Hooks (thought/action/observation/wait)
```

*(The original PDF had more detailed ASCII variants; this condenses the idea.)*
