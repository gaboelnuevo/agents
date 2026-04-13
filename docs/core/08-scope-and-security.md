# Scope and SecurityLayer

How the core **isolates** data and definitions (multi-tenant) and **authorizes** each operation before the engine runs the loop.

Related: [02-architecture.md](./02-architecture.md) (SecurityLayer before Engine), [07-definition-syntax.md](./07-definition-syntax.md) (definitions + registry), [14-consumers.md](./14-consumers.md) (where auth attaches), [19-cluster-deployment.md](./19-cluster-deployment.md) (per-worker bootstrap). Full multi-tenancy (organizations, teams, end-users): [15-multi-tenancy.md](./15-multi-tenancy.md).

---

## 1. Scope levels

| Scope | Identifier | What it isolates |
|-------|------------|------------------|
| **Global** | No `projectId` or `scope: "global"` | Not per-customer: resources shared across the deployment (e.g. `LLMAdapter`, shared utilities). |
| **Project** | `projectId` | A tenant's definitions and data: private agents, tools, skills; Redis/vector prefixes; MessageBus routes. This is the **only hard isolation boundary** the engine enforces. |
| **Session** | `sessionId` (within a project) | Working memory, conversation history, or business cycle without mixing users or parallel runs of the same agent. Optional **`expiresAtMs`** on `Session` lets the host reject further **`run`** / **`resume`** / **`onWait`** work after that instant (`SessionExpiredError`). |
| **Run** | `runId` | One execution: append-only history, `waiting` state, snapshots for `resume`. |

Typical logical key order in stores:

```text
{projectId}:{agentId}:{sessionId}:shortTerm:…          → conversation turns
{projectId}:{agentId}:{sessionId}:working:…             → session state
{projectId}:{agentId}:eu:{endUserId}:longTerm:…         → per end-user persistent facts
{projectId}:{agentId}:eu:{endUserId}:vectorMemory:…     → per end-user embeddings
{projectId}:def:tool:{toolId}                           → persisted definition
```

When no `endUserId` is present (internal / operator use), `longTerm` falls back to `sessionId`-scoped keys. See [15-multi-tenancy.md §4.3](./15-multi-tenancy.md) for the end-user memory model.

For global resources without `projectId`, the convention may be a fixed internal namespace `__global__` to unify access code.

---

## 2. Definition resolution (tool / skill)

When the agent references `tools: ["system_save_memory", "upstash_trigger"]`:

1. Resolve **project** (`projectId` from session or agent): look up definition in that namespace.
2. If missing, resolve **global** (`scope: "global"`).
3. If `id` collides, the more **specific** wins (project over global) per explicit runtime policy.

Definitions may be registered from **code** (`Tool.define` / `Skill.define` / `Agent.define`) or **hydrated** from a store into the same registry (`Skill.define` with JSON metadata + optional `execute`, or `Skill.defineBatch`); resolution rules are unchanged. See [07-definition-syntax.md](./07-definition-syntax.md) §9.2b.

**Today in core:** the prompt tool catalog is the agent allowlist (**explicit `tools` + tools from `skills`**) intersected with the **tool registry** and optional **`AgentRuntime.allowedToolIds`** — see `ContextBuilder` / `effectiveToolAllowlist`. **`SecurityContext` is not applied there yet** (no role-based hiding of tools in the LLM payload). Hosts must treat **definition resolution + agent allowlist** as the enforced surface unless they add their own filtering. Gap: [`technical-debt-security-production.md` §1](../planning/technical-debt-security-production.md#1-security-integrity-and-production-readiness) (`SecurityContext` / `ContextBuilder`).

---

## 3. SecurityLayer: role in the core

The **SecurityLayer** does not replace the engine: it **authenticates and authorizes**; the engine **executes** with an already validated **security context**.

### 3.1 Where it fits

```
Client (HTTP / SDK / CLI)  or  Organization backend (on behalf of end-user)
        │
        ▼
┌─────────────────────────┐
│  Platform API layer     │  ← resolves org membership, team → projectIds,
│                         │     end-user identity (if B2B2C)
└────────────┬────────────┘
             │
             ▼
┌───────────────────┐
│  SecurityLayer    │  ← token/API key, signature, mTLS
│  (authN + authZ)  │
└─────────┬─────────┘
          │ SecurityContext (principal + effective scopes + projectId)
          ▼
┌───────────────────┐
│  Agent Engine     │  ← run / resume / define (if exposed)
│  loop + tools     │
└───────────────────┘
```

Same boundary for embedded Node: the **platform** (or your BFF) must still authenticate/authorize **before** calling **`Agent.load(agentId, runtime, { session })`** — the SDK does not read HTTP headers. The engine then builds a **`SecurityContext`** for the run via **`securityContextForAgent(session, agent)`** (`kind: "internal"`, roles/scopes from the agent definition unless you extend the host layer).

### 3.2 Responsibilities

| Responsibility | Detail |
|----------------|--------|
| **Authentication** | Who is calling: org member, service key, end-user proxy, internal system. |
| **Authorization** | What they may do: roles and **scopes** (e.g. `agents:run`, `agents:define`, `tools:invoke:upstash_trigger`). |
| **Isolation** | Ensure the request's `projectId` belongs to the principal's organization (multi-tenant). |
| **Quotas** | Optional: per-project or per-organization limits before enqueueing a run. |

### 3.3 Principal kinds and SecurityContext

```typescript
interface SecurityContext {
  principalId: string;
  kind: "user" | "service" | "end_user" | "internal";

  organizationId: string;       // billing / membership — platform layer only
  projectId: string;            // active namespace — the engine uses THIS

  endUserId?: string;           // present when kind === "end_user" or service acts on behalf of one

  roles: string[];
  scopes: string[];
}
```

| Kind | Who | Typical scopes |
|------|-----|----------------|
| `user` | Organization member (dev, admin, operator) | `agents:define`, `agents:run`, `tools:define`, `memory:read`, `logs:read` |
| `service` | Organization backend (API key) | `agents:run`, `agents:resume` — often on behalf of end-users |
| `end_user` | Organization's customer (identified by org's auth, not the platform) | `agents:run`, `agents:resume` for exposed agents only |
| `internal` | Engine-to-engine (system jobs, schedulers, BullMQ workers) | Unrestricted within the deployment |

- `organizationId`: carried on **`SecurityContext`** for tools/consumers; **`securityContextForAgent`** currently mirrors **`session.projectId`** for embedded use. The platform should set a real org id when you expose a public API.
- `endUserId`: on **`Session`** drives **`MemoryAdapter`** keying for **`longTerm`** / **`vectorMemory`** when present; it is copied onto **`SecurityContext`** for **`ToolContext`** (see [15-multi-tenancy.md §4.3](./15-multi-tenancy.md)).

**Intended** checks (your **SecurityLayer** + product rules **before** `Agent.load` / `run`):

- **Load**: principal may use that **`agentId`** in that **`projectId`**.
- **Run / resume**: same tenant; optional quotas; for end-users, validate **`endUserId`** belongs to the customer.
- **Define**: administrative scopes; **`end_user`** principals must not define tools/agents.

**Inside core today:** **`ToolRunner`** enforces the **agent + skills (+ runtime) tool allowlist** and per-tool **`validate`**, but **does not** re-check **`SecurityContext.roles` / `scopes`** on each invocation. **`ContextBuilder`** receives **`securityContext`** on its input type but **does not use it** when building the tool list. See [`technical-debt-security-production.md` §1](../planning/technical-debt-security-production.md#1-security-integrity-and-production-readiness).

### 3.4 Alignment with `security` definitions

`roles` on `Agent.define` / `Tool.define` / `Skill.define` describe **who may use the resource** at the business model level. The SecurityLayer should:

- Map the authenticated **principal** to roles (or claims).
- Check **intersection** between principal roles and the resource's `security.roles` (or equivalent rules).

Example: an agent with `security: { roles: ["operator", "admin"] }` only enters runs if the principal includes at least one of those roles (or a finer product-defined rule).

Example (end-user): an agent with `security: { roles: ["service", "end_user"] }` can be invoked by the organization's backend or directly by end-users through the org's app.

---

## 4. Mandatory control points

| Operation | Minimum control |
|-----------|-----------------|
| `Agent.define` / `Tool.define` / `Skill.define` | Administrative scope; `projectId` bound to tenant. `end_user` principals must **never** have define permissions. |
| `Agent.load(agentId, runtime, { session })` | Principal authorized on the project; agent exists in that namespace; **`AgentRuntime`** wiring matches your deployment ([19-cluster-deployment.md](./19-cluster-deployment.md)). |
| `run` / `resume` | Same project + agent; optional concurrent run quota. For end-users: validate `endUserId` belongs to the organization's customer base. |
| **Tool** execution | Agent allowlist + scope for sensitive tools (external HTTP, payments, PII). |
| **MessageBus** | Route only between agents in the **same** `projectId` unless explicit cross-project policy. |
| **Memory** read/write | Prefixes with `projectId` + `agentId` + (`sessionId` or `endUserId`); deny if context does not match. |

Bus contract, `system_send_message` tool, and coordination with `wait`/`resume`: [09-communication-multiagent.md](./09-communication-multiagent.md).

---

## 5. Teams

Teams are **not an engine concept**. They are an organizational grouping resolved in the platform API layer before the engine is invoked.

- The platform maps team membership → allowed `projectIds`.
- The `SecurityContext` carries only the resolved `projectId`, not team metadata.
- If two teams need separate agents and memory, create separate projects.
- If two teams share agents, place them in the same project or use `scope: "global"` definitions.

Detail: [15-multi-tenancy.md §3](./15-multi-tenancy.md).

---

## 6. Relation to MVP

- **Local MVP**: fixed `SecurityContext` with `kind: "internal"` and `projectId: "default"` so the loop is not blocked.
- **Deployment MVP**: real SecurityLayer before exposing REST; keys per project; no mixed Upstash keyspaces.

See also [06-mvp.md](./06-mvp.md) (shared Redis risks) and [07-definition-syntax.md](./07-definition-syntax.md) (`security`, `projectId`, `scope`).

---

## 7. Production deployment checklist

The **SecurityLayer** and **tenant rules** in this doc are **contracts** for your **API / BFF / workers**. The core library does **not** terminate TLS, issue JWTs, or enforce RBAC on every tool unless you add that glue.

| Area | What to enforce in production |
|------|------------------------------|
| **Entry** | Authenticate every **`run`** / **`resume`**; map the principal to **`projectId`** (and **`endUserId`** when the agent serves end-users). Do not expose **`Agent.load`** / **`AgentRuntime`** construction without this step. |
| **Runs** | Treat **`runId`** as sensitive; bind **resume** to the same **session/tenant** as create (see [`technical-debt-security-production.md` §1](../planning/technical-debt-security-production.md#1-security-integrity-and-production-readiness)). Use **`RunStore`** + queue **idempotency** in clusters ([`technical-debt-security-production.md` §2](../planning/technical-debt-security-production.md#2-multi-worker-concurrency-and-integrity)). |
| **Tools** | Treat every **`system_*`** tool registered by **`AgentRuntime`** or **`@opencoreagents/rag`** (memory, vector, RAG catalog, file I/O, messaging), plus any **custom** file/HTTP tools, as **privileged**; allowlist per product; cap **LLM** and **embedding** cost (**`topK`**, timeouts). |
| **Errors & logs** | Do not stream raw **tool** stack traces or internal **`e.message`** back to the model or client; log server-side with **`runId`**. |
| **Infra** | Redis/vector **TLS**, **ACL**, key **prefixes** per environment; identical **bootstrap** (**`AgentRuntime`** wiring + definitions) on every worker ([19-cluster-deployment.md](./19-cluster-deployment.md)). |

Full gap list: [`technical-debt-security-production.md` §1–§3](../planning/technical-debt-security-production.md) (sections **1–3** in that file; hub: [`technical-debt.md`](../planning/technical-debt.md)).

---

## 8. Summary

- **Scope** (global → project → session → run) defines **namespaces** for data and definitions.
- **`projectId` is the only hard isolation boundary** the engine enforces.
- **SecurityLayer** validates **who** acts and **what** they may touch **before** the loop; revalidation on high-risk tools mid-run is uncommon but possible if context can change.
- **Organizations, teams, and end-users** are resolved to `SecurityContext` fields in the platform layer — the engine loop is unaware of these concepts. See [15-multi-tenancy.md](./15-multi-tenancy.md).
