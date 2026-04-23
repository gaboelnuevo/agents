# `@opencoreagents/adapters-redis`

TCP Redis adapters for `@opencoreagents/core` using `ioredis`.

This package provides production-oriented Redis implementations for:

- `MemoryAdapter` (`RedisMemoryAdapter`)
- `RunStore` (`RedisRunStore`)
- `MessageBus` (`RedisMessageBus`)
- `VectorAdapter` on Redis Stack / RediSearch (`RedisStackVectorAdapter`)
- Dynamic definition storage facade (`RedisDynamicDefinitionsStore`)

Use this package when you want shared state across workers/processes through a standard `redis://` endpoint.

## Install

```bash
pnpm add @opencoreagents/adapters-redis ioredis
```

## Requirements

- Node.js runtime compatible with your workspace.
- A reachable Redis instance.
- For `RedisStackVectorAdapter`: Redis Stack (or Redis with RediSearch + vector support enabled).

### Redis image requirement for vector search

If you run Redis in Docker and plan to use `RedisStackVectorAdapter`, use:

```yaml
image: redis/redis-stack:latest
```

Reason: `RedisStackVectorAdapter` relies on RediSearch vector commands such as
`FT.CREATE` and `FT.SEARCH`, which are not available in plain Redis images like
`redis:7-alpine`.

Managed alternative: DigitalOcean Valkey supports `FT.CREATE` and `FT.SEARCH`
for native search/vector search, so it can be used with `RedisStackVectorAdapter`
as long as those commands are enabled on your cluster.

## Quick Start

```ts
import Redis from "ioredis";
import { AgentRuntime } from "@opencoreagents/core";
import {
  RedisMemoryAdapter,
  RedisRunStore,
  RedisMessageBus,
  RedisStackVectorAdapter,
} from "@opencoreagents/adapters-redis";

const redis = new Redis(process.env.REDIS_URL!);

const runtime = new AgentRuntime({
  llmAdapter,
  memoryAdapter: new RedisMemoryAdapter(redis.duplicate()),
  runStore: new RedisRunStore(redis.duplicate()),
  messageBus: new RedisMessageBus(redis.duplicate()),
  embeddingAdapter,
  vectorAdapter: new RedisStackVectorAdapter(redis.duplicate()),
});
```

Notes:

- Prefer `redis.duplicate()` per adapter role in long-lived services.
- Close all clients on shutdown (`await redis.quit()`).

## Vector Adapter (Redis Stack)

`RedisStackVectorAdapter` creates one vector index per runtime namespace on demand, stores documents as Redis HASH values, and queries via `FT.SEARCH` KNN.

### Constructor

```ts
const vectorAdapter = new RedisStackVectorAdapter(redis, {
  indexPrefix: "vecidx:",
  keyPrefix: "vecdoc:",
  vectorField: "vector",
  dataField: "data",
  metadataField: "metadata",
  distanceMetric: "COSINE", // COSINE | L2 | IP
  queryExpansionFactor: 5,
});
```

### Behavior

- Upsert writes HASH docs with fields for data, metadata (JSON), and vector bytes (`FLOAT32`).
- Query returns `VectorResult[]` and maps RediSearch distances to `score`.
- Delete supports:
  - explicit ids
  - metadata filter
  - `deleteAll`

Current filter behavior is exact-match against stored metadata (applied after search results are fetched).

## Dynamic Definitions Store

`RedisDynamicDefinitionsStore` stores definitions in HASH keys:

- `{prefix}:{projectId}:httpTools`
- `{prefix}:{projectId}:skills`
- `{prefix}:{projectId}:agents`

Each field is the entity id and each value is the JSON payload.

Use:

- `store.methods` for low-level reads/writes
- `store.Agent` / `store.Skill` / `store.HttpTool` for typed CRUD

## Exports

- `RedisMemoryAdapter`
- `RedisRunStore`
- `RedisMessageBus`
- `RedisStackVectorAdapter`
- `RedisDynamicDefinitionsStore`
- `memoryKeyPrefix`

## RunStore notes

`RedisRunStore` supports the base `RunStore` contract plus session-scoped lookup:

```ts
interface RunStore {
  listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: {
      status?: RunStatus;
      limit?: number;
      cursor?: string;
      order?: "asc" | "desc";
    }
  ): Promise<{ runs: Run[]; nextCursor?: string }>;
}
```

The Redis implementation maintains a secondary `agentId + sessionId` index so common history paths scale with runs in that session instead of all runs for the agent.

## Key Compatibility

Memory/run/message-bus key semantics are aligned with `@opencoreagents/adapters-upstash`, which helps when switching between TCP Redis and Upstash REST setups.

## Related Docs

- [Adapters Infrastructure](../../docs/core/06-adapters-infrastructure.md)
- [Cluster Deployment](../../docs/core/19-cluster-deployment.md)
