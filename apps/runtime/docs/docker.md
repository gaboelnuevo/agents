# Docker for `@opencoreagents/runtime`

## Recommended for easy use

**Docker Compose** runs **Redis Stack + API + worker**. You need **`apps/runtime/config/docker.stack.yaml`** on the host (copy from **`docker.stack.example.yaml`**) — Compose mounts it read-only; **`RUNTIME_CONFIG`** points at that path.

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) with Compose v2 (BuildKit on by default on Desktop). **No pnpm required** on the host.

1. **`cd apps/runtime`** — copy **`config/docker.stack.example.yaml`** → **`config/docker.stack.yaml`** and edit **`project.id`**, **`llm`**, etc. Keep **`redis.url: redis://redis:6379`** on the bundled network.

2. **Secrets before first `up`:** copy **`.env.example`** → **`.env`** and set **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** (and optionally **`REST_API_KEY`**). For OpenAI-compatible gateways (Ollama, proxies), set **`llm.openai.baseUrl`** in **`docker.stack.yaml`** and, if needed, one model id via **`RUNTIME_DEFAULT_LLM_MODEL`** or the per-role **`RUNTIME_*_MODEL`** vars (see [configuration.md](./configuration.md#default-llm-model-environment)). Compose loads **`.env`** into **`api`** and **`worker`** (`env_file`, optional). See [security.md](./security.md).

3. **Optional artifact storage:** to let planner/chat write files through **`system_write_artifact`**, enable:

```yaml
artifacts:
  enabled: true
  rootDir: ./artifacts
```

Compose already mounts **`apps/runtime/artifacts/`** into both containers at that relative path, so generated files persist on the host.

4. From the **repository root**:

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml up --build
```

*Optional:* with pnpm, from **`apps/runtime`**: **`pnpm docker:up`** / **`pnpm docker:down`**.

Then: [http://localhost:3010/health](http://localhost:3010/health) ([`?details=1`](http://localhost:3010/health?details=1) for **`projectId`** + queue) · [http://localhost:3010/docs](http://localhost:3010/docs) (use **Authorize** with **`REST_API_KEY`** where required) · [http://localhost:8001](http://localhost:8001) (RedisInsight UI bundled in Redis Stack).

After changing **`.env`**, recreate containers: **`docker compose … up -d --force-recreate`**.

**Host-only** (`pnpm start:server` / `start:worker`): [host.md](./host.md).

## Compose details

- Build context: **repository root** (see [`Dockerfile`](../Dockerfile)).
- Binds **`./config/docker.stack.yaml`** (relative to the compose file in **`apps/runtime`**) into the containers.
- Binds **`./skills`** → **`/app/apps/runtime/config/skills`** on **api** and **worker** (read-only) so OpenClaw **`skillsDirs: [./skills]`** in **`docker.stack.yaml`** resolves inside the container. See [`skills/readme.txt`](../skills/readme.txt).
- Repo-root [`.dockerignore`](../../../.dockerignore).

## Redis image choice

Use the Redis image based on feature requirements:

- **`redis:7-alpine`**: core Redis only (strings/lists/sets/streams/pubsub). Good for memory, run store, queue, and message bus.
- **`redis/redis-stack:latest`**: Redis + modules (including RediSearch). Required for vector indexing/search with `RedisStackVectorAdapter` (`FT.CREATE`, `FT.SEARCH`, KNN).

This runtime’s compose file uses **`redis/redis-stack:latest`** so vector tooling can be enabled via stack config (`vector.enabled: true`) without changing the image again.

## Rebuild without data loss

In this repo, the safe way to rebuild without touching Redis is to rebuild only `api` and `worker`, not bring down the whole stack.

Use this from the root:

```
docker compose -f apps/runtime/docker-compose-with-redis.yml up -d --build --no-deps api worker
```

That:

* rebuilds the images for `api` and `worker`
* recreates those containers
* does not touch the Redis container

If you prefer doing it in two steps:

```
docker compose -f apps/runtime/docker-compose-with-redis.yml build api worker
docker compose -f apps/runtime/docker-compose-with-redis.yml up -d --no-deps api worker
```

Important:

Do not use `down -v`.
This compose file declares a named volume (`redis-data`) for Redis persistence. `down` keeps that volume, while `down -v` deletes it.
