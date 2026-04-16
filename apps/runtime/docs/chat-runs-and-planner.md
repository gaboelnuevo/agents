# Runs, “continuous run”, and planner — not chat in the engine

The core engine is **not** a chat product: there is **no** built-in chat UI or transcript model. **Chat** (bubbles, threads, typing indicators) lives **outside** the engine — in your BFF, mobile app, or web client.

What the engine **does** provide:

1. **Discrete `Run`** — Each **`POST /agents/:id/run`** starts (or enqueues) one run with an initial user message and an internal loop until **`result`**, **`wait`**, failure, or max iterations.
2. **Same `runId`, new user turn** — **`POST /agents/:id/continue`** with **`runId`**, **`sessionId`**, and **`message`** appends another user turn to a **`completed`** run. The LLM sees the **full prior `history`** plus the new line (via a `[continue:user] …` message). This is a **primitive for multi-turn continuity**, not a “chat” abstraction in core.
3. **`resume`** — Only when status is **`waiting`** (e.g. after a **`wait`** step), not for arbitrary follow-ups after **`completed`**. Use **`continue`** for follow-ups after **`completed`**.

**`sessionId`** still groups work for memory and listing; it does **not** merge different **`runId`** values into one prompt. **`continue`** keeps **one** **`runId`** across turns.

## Planner: `invoke_planner` without blocking the caller

The runtime tool **`invoke_planner`** enqueues a **background** planner run and returns **`runId`** / **`jobId`** immediately. The **caller’s run blocks** only if that agent also calls **`wait_for_agents`** on that id in the same cycle.

For a **front agent** that should stay responsive: allowlist **`invoke_planner`**, omit **`wait_for_agents`**, return a **`result`** that includes the planner **`runId`**. On **`POST /v1/chat`**, the default **`chat`** agent also has **`runtime_fetch_run`**: on a **later message** in the **same session**, the model can load **`status`** / **`reply`** for that **`runId`** from **`RunStore`** so the user gets the planner outcome **in the same chat thread** without SSE. Alternatively, the **client** can poll **`GET /runs/:runId`**, jobs, or **`GET /v1/runs/:runId/stream`** (when run events are enabled).

Inside the **planner** agent, **`wait_for_agents`** remains appropriate to orchestrate sub-agents.

## Quick reference

| Goal | Use |
|------|-----|
| Second (or later) user message, same logical thread in the engine | **`POST …/continue`** (run is **`completed`**, same **`runId`**) |
| User answered a **`wait`** (status **`waiting`**) | **`POST …/resume`** |
| First message / new run | **`POST …/run`** |
| Chat UI, copy, markdown rendering | Outside the engine |
| Planner in the background | **`invoke_planner`** without **`wait_for_agents`** on the front agent |
| Product-style chat with session + default agent | **`POST /v1/chat`** (runtime convenience — see below) |

## Convenience chat API (`POST /v1/chat`)

The runtime can expose a **single entrypoint** for a default **`chat`** agent (stack: **`chat.defaultAgent`**, id defaults to **`chat`**):

- **Lazy agent row:** the **`chat`** definition is written to Redis the **first time** you call **`POST /v1/chat`**, not at process boot (unlike the default **`planner`** seed).
- **Session:** omit **`sessionId`** in the body to start a new chat (server returns a new id). Re-send the same **`sessionId`** on later messages.
- **Run continuity:** the server keeps a Redis binding **`{definitions.keyPrefix}:chatBinding:{projectId}:{sessionId}`** → **`{ runId, agentId }`**. First message enqueues **`run`**; while the run is **`completed`** or **`failed`**, further messages enqueue **`continue`** on the **same** **`runId`** (so history and prior turns stay on one run). **`running`** → **409**; **`waiting`** → **409** (use plan REST **`POST /agents/:id/resume`** or a new chat session).
- **Body:** **`{ "message": string, "sessionId"?: string, "wait"?: boolean }`**. Same **`?wait=1`** / **`wait: true`** behavior as **`POST /agents/:id/run`** (needs **`queueEvents`**). Responses mirror plan REST: **202** + **`jobId`**, **`runId`**, **`sessionId`**, **`pollUrl`**, or **200** with **`reply`** when waiting.
- **Tools:** the default **`chat`** agent includes **`invoke_planner`**, **`runtime_fetch_run`** (read planner **`runId`** on follow-up turns), **`system_save_memory`**, **`system_get_memory`**. Disable the feature with **`chat.defaultAgent.enabled: false`** or **`RUNTIME_CHAT_DEFAULT_AGENT=off`**. Existing Redis **`chat`** rows keep their old tool list until you **`PUT /v1/agents/chat`** or delete and let lazy-seed recreate.

### Planner finished → notify the chat session

**`invoke_planner`** records the caller’s **`sessionId`** in the planner job’s **`sessionContext.invokedBySessionId`**. When **`runEvents.redis`** is **on**, the worker publishes to **`{definitions.keyPrefix}:chatNotify:{chatSessionId}`** when that planner BullMQ job finishes (**`planner_invocation_finished`** or **`planner_invocation_failed`**).

Subscribe with **`GET /v1/chat/stream?sessionId=`** (SSE, same **`REST_API_KEY`** as other **`/v1`** routes). The session must already exist (**`POST /v1/chat`** once so the binding key is set). This is **separate** from **`GET /v1/runs/:runId/stream`**, which streams **engine steps** for a specific run.

## API and queue

- **REST:** **`POST /agents/:agentId/continue`** — body **`{ runId, sessionId, message }`**, same shape for **`wait`** / **`projectId`** as run and resume where applicable.
- **BullMQ:** **`engine.addContinue({ … })`** — payload **`kind: "continue"`** (see **`EngineContinueJobPayload`** in **`@opencoreagents/core`**).

## Run events (SSE, optional)

When **`runEvents.redis: true`** is set in the stack (or **`RUNTIME_RUN_EVENTS_REDIS=1`**), the **worker** publishes JSON on Redis channel **`{definitions.keyPrefix}:runEvents:{runId}`** for each engine step (`thought`, `action`, `observation`, `wait`, compact `llm_*` summaries), plus **`dispatch_done`** or **`dispatch_error`** when the BullMQ job finishes. Any job kind (**`run`**, **`resume`**, **`continue`**) uses the same hooks, so **live notifications apply to continues as well** as long as you subscribe with that **`runId`**.

The **API** exposes **`GET /v1/runs/:runId/stream?sessionId=`** (Server-Sent Events). It uses the same **`REST_API_KEY`** behavior as other **`/v1`** routes and the same session / project checks as **`GET /runs/:runId`**. Use **`EventSource`** or fetch streaming in the browser; combine with **`GET /runs/:runId`** for authoritative persisted state.

**Note:** For **`kind: "run"`** jobs, if the client did not supply a **`runId`** in the enqueue payload and the job fails **before** the run exists, **`dispatch_error`** may not be published to a channel (there is no stable **`runId`** yet).

## See also

- [`../tests/chatRouter.doc-behavior.test.ts`](../tests/chatRouter.doc-behavior.test.ts) — Vitest coverage for **`POST /v1/chat`** binding, **`addRun`** / **`addContinue`**, and **409** cases (aligned with this page).
- [`../../../docs/planning/plan-rest.md`](../../../docs/planning/plan-rest.md) — Plan REST contract.
- [`../../../docs/core/15-multi-tenancy.md`](../../../docs/core/15-multi-tenancy.md) — Session and memory.
- [`../../../packages/dynamic-planner/README.md`](../../../packages/dynamic-planner/README.md) — Planner tools.
