# `@opencoreagents/runtime`

This package is a **reference deployment** of the agent stack: **Express** serves the **plan REST** surface ([`plan-rest`](../../docs/planning/plan-rest.md)) through **`@opencoreagents/rest-api`**, a **BullMQ** worker runs **`dispatch`**, and **`/v1`** reads and writes definitions in **Redis**.

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
- **`REST_API_KEY`** — protects **api REST endpoints** (`/agents`, `/jobs`, …) and **`/v1/*`**. [`docker-compose-with-redis.yml`](./docker-compose-with-redis.yml) sets a **default** (so the API can bind on **`0.0.0.0`** inside Docker and published ports work). Uncomment and set **`REST_API_KEY=`** in **`.env`** to choose your own secret; use the **same** value in Swagger **Authorize** at **`/docs`**, or send **`X-Api-Key`** / **`Authorization: Bearer …`** on API calls. Details: [Security](./docs/security.md).

Compose merges **`.env`** into **`api`** and **`worker`** (`env_file`, optional—if your Compose version does not support optional files, create an empty **`.env`** or upgrade Docker Compose).

### 4. Start the stack

From the **repository root** (not inside `apps/runtime` only):

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml up --build
```

Compose starts **Redis**, the **API**, and the **worker**, and mounts **`config/docker.stack.yaml`** into both app containers. The first run can take several minutes while dependencies install and build **inside** the image.

If you use [pnpm](https://pnpm.io/installation), you can run **`pnpm docker:up`** / **`pnpm docker:down`** from **`apps/runtime`** instead—the same compose file.

### 5. Check that it works

- [http://localhost:3010/health](http://localhost:3010/health)
- [http://localhost:3010/docs](http://localhost:3010/docs) (OpenAPI UI — use **Authorize** with your **`REST_API_KEY`** for protected routes)

Redis is also on **`localhost:6379`** from your machine if you want to connect with a client.

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

Full index: **[`docs/README.md`](./docs/README.md)**.
