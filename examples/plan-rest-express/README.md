# `plan-rest-express` — REST plugin after `Agent.define`

Uses [`@opencoreagents/rest-api`](../../packages/rest-api/) so you **define agents in code**, then **`app.use(createRuntimeRestRouter({ … }))`** for the contract in [`docs/plan-rest.md`](../../docs/plan-rest.md): **`GET /agents`**, **`POST /agents/:id/run`**, **`POST …/resume`**, **`GET /runs/:id`**, **`GET /runs/:id/history`**, **`GET /agents/:id/runs`**, **`GET …/memory`**, optional **`swagger`**. This sample uses a **fixed `projectId`** (no **`messageBus`** — **`POST /agents/:from/send`** would return **501**). For **several tenants**, omit **`projectId`** and pass **`X-Project-Id`** / **`?projectId=`** / **`body.projectId`** — see the [package README](../../packages/rest-api/README.md).

## Build

From repo root:

```bash
pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/rest-api
```

## Run

```bash
pnpm --filter @opencoreagents/example-plan-rest-express start
```

## Try

```bash
curl -s http://127.0.0.1:3050/agents
curl -s -X POST http://127.0.0.1:3050/agents/demo-greeter/run \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hi"}'
```

**OpenAPI / Swagger UI** (registered **before** tenant + API-key middleware — no auth): **`GET /openapi.json`**, **`GET /docs`**.

```bash
curl -s http://127.0.0.1:3050/openapi.json | head -c 400
# Browser: http://127.0.0.1:3050/docs
```

From the **`POST …/run`** JSON, copy **`runId`** and **`sessionId`**, then:

```bash
RUN_ID=… SESSION_ID=…
curl -s "http://127.0.0.1:3050/runs/${RUN_ID}?sessionId=${SESSION_ID}"
curl -s "http://127.0.0.1:3050/runs/${RUN_ID}/history?sessionId=${SESSION_ID}"
curl -s "http://127.0.0.1:3050/agents/demo-greeter/runs"
```

**Memory** (after a run has written working memory, or with a custom adapter):  
`GET /agents/demo-greeter/memory?sessionId=…&memoryType=working`.

Optional: `REST_API_KEY=secret` — then pass `Authorization: Bearer secret` or `X-Api-Key: secret`.

See [`docs/plan-rest.md`](../../docs/plan-rest.md) for async **`dispatch`**, **`swagger`**, multi-tenant notes, and gaps outside the library.
