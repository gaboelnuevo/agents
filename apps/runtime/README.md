# `@opencoreagents/runtime`

This package is a **reference deployment** of the agent stack: [**plan REST**](../../docs/planning/plan-rest.md) on **Express**, a **BullMQ** worker for engine jobs, and **Redis** for definitions, the queue, and **`RedisRunStore`**.

## Features

- **API REST** — Agent runs, jobs, and related HTTP surface via [`@opencoreagents/rest-api`](../../packages/rest-api/README.md); **OpenAPI** at **`/openapi.json`** and **`/docs`** (Swagger **Authorize** with your API key when enabled).
- **Worker + BullMQ** — Separate **`pnpm start:worker`** process consumes the same queue as the API; **`dispatch`** and run jobs execute out of band.
- **Definitions in Redis** — **`/v1`** CRUD for agents, skills, HTTP tools, and project definitions ([`dynamic-definitions`](../../packages/dynamic-definitions/README.md)); mutations resync the in-process registry.
- **Dynamic planner** — Server and worker register **[`@opencoreagents/dynamic-planner`](../../packages/dynamic-planner/README.md)** tools; optional seed of a default orchestrator agent (**`planner`** by default) with **`DEFAULT_PLANNER_SYSTEM_PROMPT`**.
- **`invoke_planner`** — Tool to **enqueue a background planner run** from any agent that lists it; returns immediately unless the model later **`wait_for_agents`** on that run.
- **Chat (stack-gated)** — When enabled in config, **`POST /v1/chat`** for conversational entrypoints; **`POST /agents/:agentId/continue`** with the **same `runId`** for follow-up after **`completed`** (see [Runs, continuous run, planner](./docs/chat-runs-and-planner.md)).
- **SSE streams (optional)** — With **`runEvents.redis: true`** in the stack, **`GET /v1/runs/:runId/stream?sessionId=`** for live run events (same **`sessionId`** as the run); when chat is also on, **`GET /v1/chat/stream?sessionId=`** for planner-invocation notifications.
- **Artifacts (optional)** — Enable **`artifacts.enabled: true`** to register **`system_write_artifact`** so planner/chat agents can persist generated files under a configured artifact directory (Docker Compose mounts `apps/runtime/artifacts/` by default).
- **Multi-provider LLMs** — **OpenAI** and **Anthropic**, optional **`llm.*.baseUrl`** for compatible gateways; **auto default provider/model** when **`spawn_agent`** omits **`llm`**. Optional **`RUNTIME_DEFAULT_LLM_MODEL`** sets one model id for default **`planner`** / sub-agent / **`chat`** roles when role-specific env and YAML do not pin a model (see **`.env.example`** and [Configuration](./docs/configuration.md#default-llm-model-environment)).
- **OpenClaw skills (optional)** — Load skills from **`openclaw.skillsDirs`** in the stack file when **`openclaw.enabled`** is on.
- **Declarative stack config** — One **YAML/JSON** file per environment (**`config/docker.stack.yaml`**, **`config/local.yaml`**, …), env substitution, and CLI helpers **`pnpm config:print`** / **`pnpm config:env`** ([CLI](./docs/cli.md)).
- **Security defaults** — Optional **`REST_API_KEY`** protects plan REST and **`/v1/*`**; without a key, HTTP listens on **loopback** unless you opt into **`OPENCORE_INSECURE_PUBLIC_HTTP`** ([Security](./docs/security.md)). **`GET /health`** with optional **`?details=1`**.
- **Docker reference stack** — [**`docker-compose-with-redis.yml`**](./docker-compose-with-redis.yml) runs **Redis Stack** (RediSearch included), API, and worker; see [Docker](./docs/docker.md).

### Which Redis image should I use?

- **`redis:7-alpine`** if you only need core Redis features (definitions, memory, BullMQ queue, run store, message bus).
- **`redis/redis-stack:latest`** if you need vector search/indexing via `RedisStackVectorAdapter` (`FT.CREATE` / `FT.SEARCH`), because those commands come from RediSearch modules.

The bundled compose file uses **`redis/redis-stack:latest`** so vector support can be enabled without replacing the Redis container image.

Both **server** and **worker** register **[`@opencoreagents/dynamic-planner`](../../packages/dynamic-planner/README.md)** tools and share **`RedisRunStore`** (same Redis server). On startup they **seed a default orchestrator agent** (`id` **`planner`** by default) in Redis **if it does not exist yet**, using **`DEFAULT_PLANNER_SYSTEM_PROMPT`** and the planner tool ids. Disable with **`planner.defaultAgent.enabled: false`** in the stack or **`RUNTIME_PLANNER_DEFAULT_AGENT=0`**. The default **`planner`** and **`chat`** agent ids are **not** overridable via **`PUT /v1/agents/...`** — change LLM and behavior via stack **`planner.defaultAgent`** / **`chat.defaultAgent`** (and related env vars). Other agent ids can still be upserted through **`PUT /v1/agents/:agentId`**.

When **`spawn_agent`** omits an **`llm`**, the runtime **auto-selects** a **default provider** from configured API keys and **`llm.defaultProvider`**, and a **conservative default model** (`gpt-4o-mini` / `claude-sonnet-4-6`) unless you set **`RUNTIME_DEFAULT_LLM_MODEL`**, **`RUNTIME_PLANNER_SUB_AGENT_MODEL`**, or **`planner.subAgent.model`** in YAML. **`llm.*.baseUrl`** (custom OpenAI-compatible or Anthropic endpoint) is **shared** by all agents with that **`provider`** — sub-agents do not store the URL, only **`provider` + `model`**. Use **`planner.subAgent.model`**, **`RUNTIME_PLANNER_SUB_AGENT_MODEL`**, or **`RUNTIME_DEFAULT_LLM_MODEL`** when your gateway (for example Ollama) exposes non–OpenAI-public model ids (see **`.env.example`** and [Default LLM model environment](./docs/configuration.md#default-llm-model-environment)).

The runtime also registers **`invoke_planner`**: enqueue a **background** planner run from any agent that lists it in **`tools`**. That call **returns immediately**; the **caller’s run only blocks** if the model then uses **`wait_for_agents`** on the planner’s `runId`. For a conversational front agent that should stay responsive, prefer **fire-and-forget** `invoke_planner` (and optional client polling on **`GET /runs/:runId`**) rather than **`wait_for_agents`** on that agent. For **another user message on the same logical thread** after a run **`completed`**, use **`POST /agents/:agentId/continue`** (**same `runId`**, body **`message`**) — not “chat” in core, but a **continuous run** primitive. **`sessionId`** groups sessions for memory/APIs; see **[Runs, continuous run, planner](./docs/chat-runs-and-planner.md)**.

## Run with Docker (step by step)

Do these **in order**: install and clone → settings file → **`.env` with LLM keys and (optionally) `REST_API_KEY` (before the first `up`)** → start Compose → verify.

### 1. Install Docker and clone the repository

- **Install [Docker](https://docs.docker.com/get-docker/).** On Mac and Windows, **Docker Desktop** is the usual choice and includes **Compose v2**. On Linux, install Docker Engine and the Compose plugin (see Docker’s docs for your distribution).
- **Clone this monorepo** so you have the `apps/runtime` folder on your machine (if you already have it, skip this).
- **You do not need Node.js or pnpm** on your computer for the Docker path below—everything builds inside the image.

### 2. Create your settings file

The app reads **one plain-text config file** per environment (here it ends in **`.yaml`**: sections and indentation, like an outline—open it in any editor). Start from the example file **`config/docker.stack.example.yaml`**. You need a file named **`docker.stack.yaml`** next to it (that name is what Docker Compose mounts). Easiest approaches:

- **Terminal (recommended):** copy, then edit the new file:

  ```bash
  cp config/docker.stack.example.yaml config/docker.stack.yaml
  ```

- **File explorer:** open **`apps/runtime/config/`**, **copy** **`docker.stack.example.yaml`**, then **rename the copy** to **`docker.stack.yaml`** (same result as the command above).

Avoid renaming or deleting the **`.example`** file in place—keep it in the repo as a template. Your **`docker.stack.yaml`** is gitignored and is the one you customize.

Open **`config/docker.stack.yaml`** and adjust **`project.id`**, **`definitions.keyPrefix`**, and the **`llm`** section (which model provider and how keys are passed). For this Compose setup, keep **`redis.url`** as **`redis://redis:6379`** so the app talks to the **Redis** container on the Docker network.

Inside values you can use **`${OPENAI_API_KEY}`**-style placeholders; the next step puts those variables into the containers **before** you start them. More detail: [Configuration](./docs/configuration.md).

**What the file looks like** (short preview—the **`.example`** file in the repo is the full starting point):

```yaml
environment: local

server:
  port: 3010
  host: "0.0.0.0"

project:
  id: default

redis:
  url: "redis://redis:6379"

bullmq:
  queueName: ""

definitions:
  keyPrefix: def

run:
  waitTimeoutMs: 60000

llm:
  defaultProvider: openai
  openai:
    apiKey: "${OPENAI_API_KEY}"
    baseUrl: ""
  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
    baseUrl: ""

# Optional: merge defaults are enabled: true and skillsDirs: [./skills] (relative to this file).
openclaw:
  enabled: true
  skillsDirs:
    - ./skills
```

### 3. Secrets: LLM keys and `REST_API_KEY` (before `docker compose up`)

Set environment variables **now** so the first container start already has them—you avoid editing Compose and restarting just to add keys.

From **`apps/runtime`**:

```bash
cp .env.example .env
```

Edit **`.env`** (gitignored). Typical entries:

- **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** — required if your **`docker.stack.yaml`** uses **`${OPENAI_API_KEY}`** / **`${ANTHROPIC_API_KEY}`** under **`llm`**.
- **`RUNTIME_DEFAULT_LLM_MODEL`** (optional) — one model id for default **`planner`**, **`spawn_agent`** sub-agents, and **`chat`** when YAML and per-role env do not set a model; see [Default LLM model environment](./docs/configuration.md#default-llm-model-environment).
- **`REST_API_KEY`** — protects **api REST endpoints** (`/agents`, `/jobs`, …) and **`/v1/*`**. [`docker-compose-with-redis.yml`](./docker-compose-with-redis.yml) sets a **default** (so the API can bind on **`0.0.0.0`** inside Docker and published ports work). Uncomment and set **`REST_API_KEY=`** in **`.env`** to choose your own secret; use the **same** value in Swagger **Authorize** at **`/docs`**, or send **`X-Api-Key`** / **`Authorization: Bearer …`** on API calls. Details: [Security](./docs/security.md).

Compose merges **`.env`** into **`api`** and **`worker`** (`env_file`, optional—if your Compose version does not support optional files, create an empty **`.env`** or upgrade Docker Compose).

### 4. Start the stack

From the **repository root** (not inside `apps/runtime` only):

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml up --build
```

Compose starts **Redis Stack**, the **API**, and the **worker**, and mounts **`config/docker.stack.yaml`** into both app containers. The first run can take several minutes while dependencies install and build **inside** the image.

If you use [pnpm](https://pnpm.io/installation), you can run **`pnpm docker:up`** / **`pnpm docker:down`** from **`apps/runtime`** instead—the same compose file.

### 5. Check that it works

- [http://localhost:3010/](http://localhost:3010/) — redirects to **`/ui`**, a small web playground (list agents, run, continue, poll jobs)
- [http://localhost:3010/health](http://localhost:3010/health) — add [`?details=1`](http://localhost:3010/health?details=1) to include `projectId` and queue in the JSON
- [http://localhost:3010/docs](http://localhost:3010/docs) (OpenAPI UI — use **Authorize** with your **`REST_API_KEY`** for protected routes)

Redis is also on **`localhost:6379`** from your machine if you want to connect with a client. RedisInsight UI from Redis Stack is available at **`http://localhost:8001`**.

### 6. Stop

Press `Ctrl+C`, or from the repo root:

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml down
```

If you **change `.env`** later, run **`docker compose … up -d --force-recreate`** (or down/up) so containers pick up new values.

---

**Without Docker:** copy **`config/local.example.yaml`** to **`config/local.yaml`**, edit it the same way, install Node/pnpm, and follow [Host](./docs/host.md). More on the image and Compose file: [Docker](./docs/docker.md).

## Documentation

| Guide | Contents |
|-------|----------|
| [Docker](./docs/docker.md) | Compose, Dockerfile, bind mount |
| [Why Redis](./docs/why-redis.md) | Role of Redis for definitions, queue, and memory |
| [Configuration](./docs/configuration.md) | Settings file format, templates, `loadStackRuntime`, scripts |
| [CLI](./docs/cli.md) | `config:print`, `config:env` |
| [Host](./docs/host.md) | Processes on your machine without API/worker images |
| [Cloud](./docs/cloud.md) | Replicas, managed Redis, shared env |
| [Security](./docs/security.md) | Secrets, `REST_API_KEY`, hardening |
| [Runs, continue, planner](./docs/chat-runs-and-planner.md) | **`POST …/continue`**, non-blocking `invoke_planner` (chat UI stays outside) |

Full index: **[`docs/README.md`](./docs/README.md)**.
