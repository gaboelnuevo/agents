# Why Redis for `@opencoreagents/runtime`

**Redis is the recommended data plane** for this application. The reference stack is built around **one Redis deployment** (or cluster, depending on your provider) shared by the API and all workers.

## What uses Redis

| Concern | Package / usage |
|---------|------------------|
| **Agent, skill, and HTTP tool definitions** | `@opencoreagents/adapters-redis` — `RedisDynamicDefinitionsStore` (`/v1` CRUD, worker hydration). |
| **BullMQ** | `@opencoreagents/adapters-bullmq` — job queue and **`QueueEvents`** for `wait` semantics. |
| **Agent memory** (worker) | `RedisMemoryAdapter` — durable memory across worker restarts and replicas. |

All of the above use **TCP Redis** via **`ioredis`** in this repo’s wiring. There is **no** in-process or file-based fallback in `server.ts` / `worker.ts`: you need a reachable **`redis.url`** in your stack file (or **`REDIS_URL`** override).

## Recommendations

1. **Local / easy setup — use Docker Compose** — In this repo, **`apps/runtime/docker-compose-with-redis.yml`** starts Redis together with the API and worker (recommended). You can also run **`up -d redis`** only and point **`config/local.yaml`** at `127.0.0.1:6379`. **Staging/production:** use a **managed** Redis (e.g. AWS ElastiCache, GCP Memorystore, Azure Cache for Redis) or a hardened self-hosted deployment.
2. **Use TLS and password (or IAM-style auth if your cloud offers it)** for anything exposed beyond `localhost`. Put credentials in the URL (`redis://user:pass@host:6379`) or as your provider documents; the worker log **redacts** userinfo — still treat URLs as secrets in config stores.
3. **Keep `project.id` and `definitions.keyPrefix` identical** on every API and worker process so definitions, memory keys, and dispatch line up. Optionally align **`ENGINE_QUEUE_NAME`** explicitly if you run multiple logical stacks against one Redis.
4. **Capacity** — BullMQ and high churn jobs add load; monitor memory, connections, and latency. Prefer connection pooling discipline (this app uses **`duplicate()`** for separate BullMQ connections; follow your provider’s limits).
5. **Persistence** — For **queues**, many operators use **no AOF/RDB** or short retention on ephemeral environments; for **definitions** stored only in Redis, treat Redis as the source of truth and back up or export if you cannot afford loss. Choose RTO/RPO accordingly.

## Further reading

- [`@opencoreagents/adapters-redis`](../../../packages/adapters-redis/README.md) — key layout and facades.
- [`docs/core/06-adapters-infrastructure.md`](../../../docs/core/06-adapters-infrastructure.md) and [`docs/core/19-cluster-deployment.md`](../../../docs/core/19-cluster-deployment.md) — broader deployment context.
