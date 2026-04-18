# Docker for `@opencoreagents/runtime`

## Recommended for easy use

**Docker Compose** runs **Redis + API + worker**. You need **`apps/runtime/config/docker.stack.yaml`** on the host (copy from **`docker.stack.example.yaml`**) — Compose mounts it read-only; **`RUNTIME_CONFIG`** points at that path.

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) with Compose v2 (BuildKit on by default on Desktop). **No pnpm required** on the host.

1. **`cd apps/runtime`** — copy **`config/docker.stack.example.yaml`** → **`config/docker.stack.yaml`** and edit **`project.id`**, **`llm`**, etc. Keep **`redis.url: redis://redis:6379`** on the bundled network.

2. **Secrets before first `up`:** copy **`.env.example`** → **`.env`** and set **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** (and optionally **`REST_API_KEY`**). For OpenAI-compatible gateways (Ollama, proxies), set **`llm.openai.baseUrl`** in **`docker.stack.yaml`** and, if needed, one model id via **`RUNTIME_DEFAULT_LLM_MODEL`** or the per-role **`RUNTIME_*_MODEL`** vars (see [configuration.md](./configuration.md#default-llm-model-environment)). Compose loads **`.env`** into **`api`** and **`worker`** (`env_file`, optional). See [security.md](./security.md).

3. From the **repository root**:

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml up --build
```

*Optional:* with pnpm, from **`apps/runtime`**: **`pnpm docker:up`** / **`pnpm docker:down`**.

Then: [http://localhost:3010/health](http://localhost:3010/health) ([`?details=1`](http://localhost:3010/health?details=1) for **`projectId`** + queue) · [http://localhost:3010/docs](http://localhost:3010/docs) (use **Authorize** with **`REST_API_KEY`** where required).

After changing **`.env`**, recreate containers: **`docker compose … up -d --force-recreate`**.

**Host-only** (`pnpm start:server` / `start:worker`): [host.md](./host.md).

## Compose details

- Build context: **repository root** (see [`Dockerfile`](../Dockerfile)).
- Binds **`./config/docker.stack.yaml`** (relative to the compose file in **`apps/runtime`**) into the containers.
- Binds **`./skills`** → **`/app/apps/runtime/config/skills`** on **api** and **worker** (read-only) so OpenClaw **`skillsDirs: [./skills]`** in **`docker.stack.yaml`** resolves inside the container. See [`skills/readme.txt`](../skills/readme.txt).
- Repo-root [`.dockerignore`](../../../.dockerignore).
