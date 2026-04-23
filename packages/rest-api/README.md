# `@opencoreagents/rest-api`

**Plugin-style** Express **`Router`**: after you **`Agent.define`** (and tools/skills), mount **`createRuntimeRestRouter({ … })`** to expose JSON routes for agents/runs/jobs (URL contract: **`docs/planning/plan-rest.md`**) without copying handlers from scratch. A minimal runnable host is [`examples/plan-rest-express`](../../examples/plan-rest-express/) (enables **`swagger`** → **`GET /openapi.json`**, **`GET /docs`**).

**Execution modes**

| Mode | Options | Behavior |
|------|---------|----------|
| **Inline** (default) | **`runtime`** | **`POST` run / resume / continue** call **`Agent.run` / `resume` / `continueRun`** in the HTTP process. With **`runtime.config.messageBus`**, **`POST /agents/:fromAgentId/send`** calls **`MessageBus.send`** (**`system_send_message`** semantics). |
| **Queue** | **`dispatch: { engine, queueEvents?, jobWaitTimeoutMs? }`** | **`POST` run / resume / continue** call **`engine.addRun` / `addResume` / `addContinue`** — same job payload family as **`examples/dynamic-runtime-rest`**. Default **202** + **`jobId`** + **`projectId`** + **`statusUrl`**; **`?wait=1`** or **`"wait": true`** blocks until the worker finishes (**needs `queueEvents`**). **`504`** vs **502** on wait uses **`isBullmqJobWaitTimeoutError`** (BullMQ timeout message shape). |
| **Both** | **`runtime` + `dispatch`** | **`dispatch`** wins for **`POST` run / resume / continue**; **`runtime`** still used if you omit **`dispatch`** (not typical). |

Install **`@opencoreagents/adapters-bullmq`** and **`bullmq`** when using **`dispatch`** (optional **peer** dependencies).

## Routes

| Method | Path | Notes |
|--------|------|-------|
| **GET** | `/agents` | With **`agentIds`**: intersection of allowlist and registry for the effective **`projectId`**. Without: all agents **`Agent.load`** can resolve. |
| **GET** | `/agents/:agentId/memory` | **When `runtime` is set:** **`?sessionId=`** and **`?memoryType=`** required; optional **`?endUserId=`**. Returns **`{ projectId, agentId, sessionId, memoryType, items }`** from **`MemoryAdapter.query`** (same scope as **`system_get_memory`**). Omitting **`runtime`** (enqueue-only API) leaves this route **unregistered**. |
| **POST** | `/agents/:fromAgentId/send` | **When `runtime` is set:** body **`toAgentId`**, **`payload`** (required); optional **`type`** (**`event`** \| **`request`** \| **`reply`**), **`correlationId`** (required for **`request`**/**`reply`**), **`sessionId`**, **`endUserId`** (for **`sendMessageTargetPolicy`** only). **501** if **`AgentRuntime`** has no **`messageBus`**. **403** when policy denies the target. Unregistered without **`runtime`**. |
| **POST** | `/agents/:agentId/run` | Body: `{ "message": string, "sessionId"?: string, "expiresAtMs"?: number, "extendSessionTtlMs"?: number, "projectId"?: string, "wait"?: boolean }`. **`wait`**: only with **`dispatch`** (+ **`queueEvents`**). Success JSON includes **`projectId`** (effective tenant). |
| **POST** | `/agents/:agentId/resume` | Body: `{ runId, sessionId, resumeInput, "expiresAtMs"?: number, "extendSessionTtlMs"?: number, "projectId"?, "wait"? }`. **Inline** mode needs **`runStore`** on **`AgentRuntime`**. **Queue** mode does not need **`runStore`** on the API process (worker must persist runs). Success JSON includes **`projectId`**. |
| **POST** | `/agents/:agentId/continue` | Body: `{ runId, sessionId, message, "expiresAtMs"?: number, "extendSessionTtlMs"?: number, "projectId"?, "wait"? }`. Appends a user turn to a **`completed`** run (**same `runId`**). Same **`runStore`** / **`dispatch`** rules as **`resume`**. |
| **GET** | `/runs/:runId?sessionId=` | Requires **`runStore`**. **`sessionId`** must match the run when stored. If the run has **`projectId`** (set on new runs in **`@opencoreagents/core`**), the effective tenant must match or the handler returns **403**; the JSON body may include **`projectId`**. In **multi-project** mode, send **`X-Project-Id`** or **`?projectId=`** (same resolution as below). |
| **GET** | `/runs/:runId/history?sessionId=` | Same auth as **`GET /runs/:runId`** — returns **`Run.history`** (**`ProtocolMessage[]`**) plus **`runId`**, **`agentId`**, **`status`**, optional **`sessionId`** / **`projectId`**. |
| **GET** | `/agents/:agentId/runs` | Requires **`runStore`**. Optional **`?status=`** (**`running` \| `waiting` \| `completed` \| `failed`**), **`?sessionId=`**, **`?limit=`** (default **50**, max **100**). When **`sessionId`** is set, the router uses **`RunStore.listByAgentAndSession(agentId, sessionId, { status?, limit?, order: "desc" })`**; otherwise it falls back to **`listByAgent`**. Same **`run.projectId`** vs tenant rule as **`GET /runs`** when **`projectId`** is set on rows. |
| **GET** | `/jobs/:jobId` | Only when **`dispatch`** is set — poll BullMQ job (**`state`**, **`run`** summary when completed), same idea as **`GET /v1/jobs/:id`** in **`dynamic-runtime-rest`**. |

Optional auth: **`resolveApiKey(req, res)`** (recommended — lazy env, **per-`projectId` secrets** via **`getRuntimeRestRouterProjectId(res)`**) and/or static **`apiKey`**. Tenant middleware runs **before** API-key checks. When the effective secret is non-empty, clients must send **`Authorization: Bearer …`** or **`X-Api-Key`**. Use **`createOptionalRuntimeRestApiKeyMiddleware({ … })`** (same rules) to protect **other** Express mounts with the same secret (e.g. admin routes next to this router).

### One fixed project

Pass **`projectId`** in options. Clients do not need a tenant header; **`X-Project-Id`** / **`?projectId=`** are ignored.

### Many projects (multi-tenant)

Omit **`projectId`** from options. Each request resolves the tenant in order:

1. Header **`X-Project-Id`**
2. Query **`?projectId=`** (works for **GET** routes that read **`runStore`**, e.g. **`GET /runs`**, **`GET /runs/:runId/history`**, **`GET /agents/:agentId/runs`**)
3. JSON **`body.projectId`** (works for **POST** run/resume; **GET** tenant uses header/query only — same examples as above)

Optional **`allowedProjectIds`**: if set (and not wildcard-only), any other **`projectId`** gets **403**. Use **`["*"]`** to accept **any** resolved tenant (still require header/query/body **`projectId`** in multi mode; use **`resolveApiKey`** / **`apiKey`** in production).

When **`agentIds` is omitted**, every agent registered for that tenant (plus globals) is invocable — use **`agentIds`** to restrict names (undefined ids never appear in the list and yield **404** on run/resume).

### Engine errors (inline routes)

For **`EngineError`** subclasses from **`@opencoreagents/core`**, inline **`POST …/run`**, **`POST …/resume`**, **`GET /runs/:runId`**, and **`GET /runs/:runId/history`** return a stable **`code`** (e.g. **`SESSION_EXPIRED`** → **401**, **`RUN_INVALID_STATE`** → **409**, **`LLM_RATE_LIMIT`** → **429**) plus **`error`** text. You can reuse **`mapEngineErrorToHttp(err)`** in your own middleware. Non-engine failures keep generic status bodies. The OpenAPI spec includes **`components.schemas.RuntimeRestJsonError`** (`error` required, `code` optional); **`RUNTIME_REST_ENGINE_ERROR_CODES`** lists codes with explicit HTTP mapping in **`mapEngineErrorToHttp`**.

### Session expiry inputs

Inline and queued **`run`**, **`resume`**, and **`continue`** accept two optional timing fields:

- **`expiresAtMs`** — absolute Unix ms deadline forwarded to **`Session({ expiresAtMs })`** / **`EngineJobPayload.expiresAtMs`**
- **`extendSessionTtlMs`** — extend the session lifetime by this many ms

If both are present, the router applies **`extendSessionTtlMs`** on top of the later of **`expiresAtMs`** or **now**. This gives hosts a simple “keep this session alive for N more milliseconds” input without recomputing an absolute deadline client-side.

## Phased plan ([`docs/planning/plan-rest.md`](../../docs/planning/plan-rest.md))

| Phase | In this package |
|-------|-----------------|
| **R0 — Contract** | OpenAPI **3.0** (`swagger: true`) + **`RuntimeRestJsonError`**; **`mapEngineErrorToHttp`** for **`EngineError` → HTTP** on inline routes. |
| **R1 — Minimal server** | **`GET /agents`**, **`GET …/memory`**, **`POST …/send`** (with **`runtime`** + optional **`messageBus`**), **`POST` run/resume**, **`GET /runs`** / **`GET …/history`** + **`runStore`**. |
| **R2 — Async** | **`dispatch`** + **`GET /jobs/:jobId`**, **`wait=1`**, **`isBullmqJobWaitTimeoutError`**. |
| **R3 — Multi-tenant** | **`projectId`** / **`resolveProjectId`**, **`allowedProjectIds`**, **`resolveApiKey`**. |
| **R4 — Streaming** | Not here — use **`examples/real-world-with-express`** or custom SSE. |

## Usage

**Single project** (simplest):

```typescript
import express from "express";
import { createRuntimeRestRouter } from "@opencoreagents/rest-api";
import { Agent, AgentRuntime, InMemoryMemoryAdapter, InMemoryRunStore } from "@opencoreagents/core";

const runStore = new InMemoryRunStore();
const runtime = new AgentRuntime({
  llmAdapter: /* … */,
  memoryAdapter: new InMemoryMemoryAdapter(),
  runStore,
});

await Agent.define({
  id: "my-agent",
  projectId: "my-project",
  // …
});

const app = express();
app.use(
  createRuntimeRestRouter({
    runtime,
    projectId: "my-project",
    runStore,
    resolveApiKey: () => process.env.REST_API_KEY?.trim(),
  }),
);

app.listen(3000);
```

**Several projects** on one router (clients send the tenant per request):

```typescript
await Agent.define({ id: "assistant", projectId: "acme", /* … */ });
await Agent.define({ id: "assistant", projectId: "contoso", /* … */ });

app.use(
  createRuntimeRestRouter({
    runtime,
    allowedProjectIds: ["acme", "contoso"],
    runStore,
  }),
);
// e.g. curl -H "X-Project-Id: acme" http://localhost:3000/agents
// or POST …/run with { "projectId": "acme", "message": "hi" }
```

**Per-project API keys** (after **`allowedProjectIds`** / **`resolveProjectId`** have determined the tenant):

```typescript
import {
  createRuntimeRestRouter,
  getRuntimeRestRouterProjectId,
} from "@opencoreagents/rest-api";

const keys: Record<string, string> = {
  acme: process.env.REST_API_KEY_ACME!,
  contoso: process.env.REST_API_KEY_CONTOSO!,
};

app.use(
  createRuntimeRestRouter({
    runtime,
    allowedProjectIds: ["acme", "contoso"],
    runStore,
    resolveApiKey: (_req, res) => {
      const projectId = getRuntimeRestRouterProjectId(res);
      return projectId ? keys[projectId]?.trim() : undefined;
    },
  }),
);
```

Open multi-tenant (any project id the client sends, after resolution):

```typescript
app.use(
  createRuntimeRestRouter({
    runtime,
    allowedProjectIds: ["*"],
    runStore,
    resolveApiKey: () => process.env.REST_API_KEY?.trim(),
  }),
);
```

**BullMQ enqueue** (worker runs **`AgentRuntime.dispatch`** — see [`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/)):

```typescript
import { createEngineQueue } from "@opencoreagents/adapters-bullmq";
import { QueueEvents } from "bullmq";
import Redis from "ioredis";

const connection = { host: "127.0.0.1", port: 6379 };
const engine = createEngineQueue("engine", connection);
const queueEvents = new QueueEvents("engine", { connection });
await queueEvents.waitUntilReady();

app.use(
  createRuntimeRestRouter({
    dispatch: {
      engine,
      queueEvents,
      jobWaitTimeoutMs: 120_000,
    },
    projectId: "my-project",
    // runtime optional — list agents from in-process registry or define agents in API + worker bootstrap
  }),
);
// POST …/run → 202 { jobId, statusUrl } or ?wait=1 → 200 { runId, status, reply? }
```

Override resolution with **`resolveProjectId(req)`** if you use JWT claims or a path prefix. **`defaultRuntimeRestResolveProjectId`** is exported if you want to extend the default chain.

Mount under a prefix: **`app.use("/api", createRuntimeRestRouter({ … }))`** → **`GET /api/agents`**, etc.

### OpenAPI / Swagger UI

Set **`swagger: true`** (or an object) on **`createRuntimeRestRouter`** to add:

- **`GET …/openapi.json`** — OpenAPI **3.0** document (paths match this router).
- **`GET …/docs`** — Swagger UI (loads **Swagger UI** from [unpkg](https://unpkg.com/); allow that CDN in **`Content-Security-Policy`** if you use one).

Defaults: **`openapi.json`** + **`docs`**. Customize with **`swagger: { openApiPath, uiPath, info?: { title, version, description }, extendOpenApi?: (spec) => spec }`** — use **`extendOpenApi`** to merge paths (e.g. host-mounted **`/v1/...`** definition CRUD) into the same document for one Swagger UI.

These routes are registered **before** API-key and tenant middleware, so they do not require **`Authorization`** or **`X-Project-Id`**. Put **`app.use`** in front of the router if you need to protect them. Production notes (CSP, public spec): [`docs/planning/technical-debt-security-production.md`](../../docs/planning/technical-debt-security-production.md#1-security-integrity-and-production-readiness) §1 (*OpenAPI / Swagger UI*).

You can also call **`buildRuntimeRestOpenApiSpec({ … })`** and **`runtimeRestSwaggerUiHtml(openApiPath, uiPath)`** from **`@opencoreagents/rest-api`** to serve the spec or UI yourself.

## Docs

[`docs/planning/plan-rest.md`](../../docs/planning/plan-rest.md) (roadmap + contract table). This package implements the **Implemented today** surface (inline **`runtime`**, optional **`dispatch`**, **`runStore`**, **`swagger`**). Worker wiring for BullMQ matches [`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/).
