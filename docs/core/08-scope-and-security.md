# Scope and SecurityLayer

How the core **isolates** data and definitions (multi-tenant) and **authorizes** each operation before the engine runs the loop.

---

## 1. Scope levels

| Scope | Identifier | What it isolates |
|-------|------------|------------------|
| **Global** | No `projectId` or `scope: "global"` | Not per-customer: resources shared across the deployment (e.g. `LLMAdapter`, shared utilities). |
| **Project** | `projectId` | A tenant’s definitions and data: private agents, tools, skills; Redis/vector prefixes; MessageBus routes. |
| **Session** | `sessionId` (within a project) | Working memory, conversation history, or business cycle without mixing users or parallel runs of the same agent. |
| **Run** | `runId` | One execution: append-only history, `waiting` state, snapshots for `resume`. |

Typical logical key order in stores:

```text
{projectId}:{agentId}:{sessionId}:…   → memory / locks
{projectId}:def:tool:{toolId}         → persisted definition
```

For global resources without `projectId`, the convention may be a fixed internal namespace `__global__` to unify access code.

---

## 2. Definition resolution (tool / skill)

When the agent references `tools: ["save_memory", "upstash_trigger"]`:

1. Resolve **project** (`projectId` from session or agent): look up definition in that namespace.
2. If missing, resolve **global** (`scope: "global"`).
3. If `id` collides, the more **specific** wins (project over global) per explicit runtime policy.

The **Context Builder** must only inject into the prompt tools **visible** after this resolution **and** after SecurityLayer filtering (§4).

---

## 3. SecurityLayer: role in the core

The **SecurityLayer** does not replace the engine: it **authenticates and authorizes**; the engine **executes** with an already validated **security context**.

### 3.1 Where it fits

```
Client (HTTP / SDK / CLI)
        │
        ▼
┌───────────────────┐
│  SecurityLayer    │  ← token/API key, signature, mTLS
│  (authN + authZ)  │
└─────────┬─────────┘
          │ Principal + effective scopes
          ▼
┌───────────────────┐
│  Agent Engine     │  ← run / resume / define (if exposed)
│  loop + tools     │
└───────────────────┘
```

Same boundary for embedded Node only: the caller passes an explicit `SecurityContext` instead of HTTP headers.

### 3.2 Responsibilities

| Responsibility | Detail |
|----------------|--------|
| **Authentication** | Who is calling: user, service key, web session. |
| **Authorization** | What they may do: roles and **scopes** (e.g. `agents:run`, `agents:define`, `tools:invoke:upstash_trigger`). |
| **Isolation** | Ensure the request’s `projectId` belongs to the principal (multi-tenant). |
| **Quotas** | Optional: per-project limits before enqueueing a run. |

### 3.3 Principal and effective context

Typical object injected into the engine (conceptual):

```typescript
interface SecurityContext {
  principalId: string;
  kind: "user" | "service" | "internal";
  roles: string[];
  scopes: string[];
  projectIds: string[]; // allowed; or "*" in dev
}
```

The engine and ToolRunner consult this context when:

- **Loading** an agent: can the principal use that `agentId` in that `projectId`?
- **Executing** `action`: is the requested tool on the agent allowlist **and** does the principal have scope to invoke it?
- **Defining** (`Tool.define` / `Agent.define`): administrative scopes separate from `agents:run`.

### 3.4 Alignment with `security` definitions

`roles` on `Agent.define` / `Tool.define` / `Skill.define` describe **who may use the resource** at the business model level. The SecurityLayer should:

- Map the authenticated **principal** to roles (or claims).
- Check **intersection** between principal roles and the resource’s `security.roles` (or equivalent rules).

Example: an agent with `security: { roles: ["operator", "admin"] }` only enters runs if the principal includes at least one of those roles (or a finer product-defined rule).

---

## 4. Mandatory control points

| Operation | Minimum control |
|-----------|-----------------|
| `Agent.define` / `Tool.define` / `Skill.define` | Administrative scope; `projectId` bound to tenant. |
| `Agent.load` | Principal authorized on the project; agent exists in that namespace. |
| `run` / `resume` | Same project + agent; optional concurrent run quota. |
| **Tool** execution | Agent allowlist + scope for sensitive tools (external HTTP, payments, PII). |
| **MessageBus** | Route only between agents in the **same** `projectId` unless explicit cross-project policy. |
| **Memory** read/write | Prefixes with `projectId` + `agentId` + `sessionId`; deny if context does not match. |

Bus contract, `send_message` tool, and coordination with `wait`/`resume`: [09-communication-multiagent.md](./09-communication-multiagent.md).

---

## 5. Relation to MVP

- **Local MVP**: fixed `SecurityContext` like `internal` with `projectIds: ["*"]` so the loop is not blocked.
- **Deployment MVP**: real SecurityLayer before exposing REST; keys per project; no mixed Upstash keyspaces.

See also [06-mvp.md](./06-mvp.md) (shared Redis risks) and [07-definition-syntax.md](./07-definition-syntax.md) (`security`, `projectId`, `scope`).

---

## 6. Summary

- **Scope** (global → project → session → run) defines **namespaces** for data and definitions.
- **SecurityLayer** validates **who** acts and **what** they may touch **before** the loop; revalidation on high-risk tools mid-run is uncommon but possible if context can change.
