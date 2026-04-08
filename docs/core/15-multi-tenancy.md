# Multi-tenancy: organizations, projects, and end-users

How the platform maps **business entities** (organizations, teams, end-users) to **engine primitives** (`projectId`, `sessionId`, `SecurityContext`) without polluting the core loop.

Related: [08-scope-and-security.md](./08-scope-and-security.md) (scope levels, SecurityLayer), [07-definition-syntax.md](./07-definition-syntax.md) (Session, SecurityContext types), [05-adapters.md](./05-adapters.md) (memory key patterns).

---

## 1. Three-layer model

```
Organization   (billing, identity, membership)
  └── Project  (data isolation, agent namespace)   ← projectId
       └── Session  (conversation / run scope)     ← sessionId
            └── Run  (single execution)            ← runId
```

| Layer | Identifier | Boundary type | Engine sees it? |
|-------|------------|---------------|-----------------|
| **Organization** | `organizationId` | Billing, auth, member roster | No — platform API only |
| **Project** | `projectId` | Hard data isolation: agents, tools, skills, memory, MessageBus, queues | **Yes** — primary namespace |
| **Session** | `sessionId` | Conversation history, working memory, run grouping | **Yes** |
| **Run** | `runId` | Single execution: append-only history, `waiting` state | **Yes** |

### Why this structure

- **Organization** is the paying entity. It owns API keys, members with roles, and a billing plan. The engine never reads this — it belongs to the platform/API layer.
- **Project** is the unit of **hard isolation**. Different projects share nothing: no memory, no agent definitions, no MessageBus routes, no queue jobs. One organization may own many projects.
- **Session** scopes a conversation or business cycle within a project. Multiple sessions in the same project share agent definitions and tools but have independent short-term history and working memory.

---

## 2. Mapping business models

The three-layer model accommodates different product shapes without changing the engine:

| Product shape | Organization | Project(s) | Session |
|---------------|--------------|------------|---------|
| **B2C / indie dev** | One user = one org | Single project | Per conversation |
| **B2B small team** | Company = org, all members share | Single project | Per conversation or per workflow |
| **B2B enterprise with divisions** | Company = org | One project per team / department / environment | Per conversation |
| **B2B2C (end-user facing agents)** | Company = org | One project per product line or environment | Per end-user conversation |

The key insight: when two groups within the same organization need **hard data separation** (different agents, separate memory, independent audit), create **separate projects**. Do not add sub-namespaces inside a project — the project boundary already provides full isolation.

---

## 3. Teams: authorization, not isolation

Teams are an **organizational concept**, not an engine primitive. They map to **which projects a member can access**, not to storage prefixes or bus routes.

```
Organization: Acme Corp
  ├── Team: Sales   → access to project "acme-sales"
  ├── Team: Ops     → access to project "acme-ops"
  └── Team: Shared  → access to projects "acme-sales" + "acme-ops"
```

- The platform API resolves team membership → allowed `projectIds` when building `SecurityContext`.
- The engine only sees `projectId`; it does not know what a "team" is.
- If both teams share a common tool, define it with `scope: "global"` or in a shared project both teams can access.

---

## 4. End-users (B2B2C)

When an organization builds agents that interact with **its own customers** (support bots, onboarding assistants, etc.), the end-user is not a platform member. They interact through the organization's application.

### 4.1 Flow

```
End-user (org's customer)
        │  chat widget / app / WhatsApp
        ▼
┌─────────────────────────┐
│  Organization's app     │  ← authenticates end-user with its own auth
│  (frontend + backend)   │
└────────────┬────────────┘
             │  API call with org's service key + endUserId
             ▼
┌─────────────────────────┐
│  Platform API layer     │  ← validates service key, builds SecurityContext
└────────────┬────────────┘
             │  SecurityContext { projectId, endUserId, kind: "service", … }
             ▼
┌─────────────────────────┐
│  SecurityLayer          │  ← authN + authZ
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Agent Engine           │  ← run / resume with sessionId
└─────────────────────────┘
```

The end-user **never calls the platform directly**. The organization's backend authenticates its customer and calls the platform API with a service key. The platform builds a `SecurityContext` scoped to `agents:run` / `agents:resume` only.

### 4.2 Principal kinds

| Kind | Who | Typical permissions |
|------|-----|---------------------|
| `user` | Organization member (dev, admin, operator) | `agents:define`, `agents:run`, `tools:define`, logs, memory inspect |
| `service` | Organization backend (API key) | `agents:run`, `agents:resume` on behalf of end-users |
| `end_user` | Organization's customer (resolved by org backend) | `agents:run`, `agents:resume` for exposed agents only |
| `internal` | Engine-to-engine (system jobs, schedulers) | Unrestricted within the deployment |

### 4.3 Memory scoping with end-users

An end-user facing agent needs two distinct memory scopes:

| Memory type | Scoped by | Lifecycle | Example |
|-------------|-----------|-----------|---------|
| `shortTerm` | `sessionId` | Per conversation | Last 20 turns of this chat |
| `working` | `sessionId` | Per conversation | Current ticket state, flags |
| `longTerm` | `endUserId` | **Across conversations** | "Customer has premium plan, prefers formal tone, had refund last week" |
| `vectorMemory` | `endUserId` | **Across conversations** | Semantic embeddings of past interactions |

Key patterns:

```text
{projectId}:{agentId}:{sessionId}:shortTerm:…       → this conversation's turns
{projectId}:{agentId}:{sessionId}:working:…          → this conversation's state

{projectId}:{agentId}:eu:{endUserId}:longTerm:…      → persistent end-user facts
{projectId}:{agentId}:eu:{endUserId}:vectorMemory:…  → end-user embeddings
```

When `endUserId` is present in the session, the **MemoryAdapter** uses it as the key segment for `longTerm` and `vectorMemory` instead of `sessionId`. The **Context Builder** reads both scopes to assemble the prompt: long-term facts about the end-user plus short-term conversation history.

### 4.4 Session with end-user

```typescript
const session = new Session({
  id: "customer-456:conv-20260407-001",
  projectId: "acme-support",
  endUserId: "customer-456",
});

const agent = await Agent.load("support-bot", { session });
await agent.run("My order #8812 hasn't arrived");
```

The engine loop does not change. `endUserId` is metadata that the MemoryAdapter and Context Builder use for key resolution; the loop still processes `thought → action → observation → wait → result` the same way.

### 4.5 End-user example: support agent

```typescript
await Agent.define({
  id: "support-bot",
  projectId: "acme-support",
  systemPrompt: "You are Acme's support agent. Help customers with orders and account issues...",
  tools: ["get_memory", "save_memory", "get_order_status", "create_ticket"],
  memoryConfig: {
    shortTerm: { maxTurns: 20 },
    longTerm: true,
    working: {},
  },
  security: { roles: ["service", "end_user"] },
});
```

At runtime the agent can:

1. Read `longTerm` (keyed by `endUserId`) → "This customer is on the premium plan, had a refund last week."
2. Call `get_order_status` → external tool querying the org's order API.
3. Emit `wait` with `reason: "user_input"` → "Would you like a refund or a replacement?"
4. On `resume` with end-user's answer → call `create_ticket` and return `result`.
5. Call `save_memory` to `longTerm` → persists that this customer received a refund.

The next time this end-user opens a new conversation (different `sessionId`, same `endUserId`), the agent already knows their history.

---

## 5. SecurityContext (canonical)

```typescript
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

| Field | Used by engine? | Purpose |
|-------|-----------------|---------|
| `principalId` | Yes (audit, locks) | Who initiated the request |
| `kind` | Yes (scope filtering) | Principal type — determines default permission ceiling |
| `organizationId` | No (platform only) | Billing, quotas, membership validation |
| `projectId` | **Yes** (primary) | Namespace for all engine data and definitions |
| `endUserId` | Passed through to MemoryAdapter | Long-term memory key when present |
| `roles` | Yes | Intersection with resource `security.roles` |
| `scopes` | Yes | Fine-grained permissions (`agents:run`, `agents:define`, etc.) |

---

## 6. What lives where

| Concept | Layer | The engine core knows about it? |
|---------|-------|-------------------------------|
| Organization, billing, plan | Platform API / DB | No |
| User identity, membership | Auth layer (JWT, sessions) | Only as `principalId` + `kind` |
| Team | Platform API / membership DB | No — resolved to allowed `projectIds` before engine |
| Project | `projectId` everywhere | **Yes** — primary namespace |
| End-user | `endUserId` in Session / SecurityContext | Passed through to MemoryAdapter; engine loop is unaware |
| Session | `sessionId` | **Yes** |
| Run | `runId` | **Yes** |

---

## 7. Design rules

1. **`projectId` is the only hard isolation boundary the engine enforces.** No sub-namespaces, no realm segments inside a project.
2. **If two groups need separate data, create separate projects.** Do not invent intermediate scoping layers.
3. **Teams are authorization claims, not storage segments.** Map team membership to `projectIds` in the platform layer.
4. **End-users are not platform users.** They are identified by `endUserId`, authenticated by the organization's own auth, and limited to `agents:run` / `agents:resume`.
5. **Long-term memory for end-users is keyed by `endUserId`, not `sessionId`.** This allows persistence across conversations.
6. **The engine loop does not change** for any tenancy model. All business-model concepts are resolved to `SecurityContext` + `Session` before the loop starts.
