# `@agent-runtime/adapters-redis`

TCP Redis (`ioredis`) implementations of **`MemoryAdapter`**, **`RunStore`**, and **`MessageBus`** for `@agent-runtime/core`.

Use a single **`REDIS_URL`** / `redis://` connection for shared memory, persisted runs (`wait` / `resume` across workers), and **`send_message`** over Redis Streams — the same key and stream layout as `@agent-runtime/adapters-upstash`, so you can swap between TCP and Upstash REST without changing engine code.

**Vector** search is not included; use `@agent-runtime/adapters-upstash` (`UpstashVectorAdapter`) or another `VectorAdapter` for embeddings/RAG.

## Exports

- `RedisMemoryAdapter`
- `RedisRunStore`
- `RedisMessageBus`
- `memoryKeyPrefix` (key helper; matches Upstash memory key semantics)

## Docs

- [05-adapters.md](../../docs/core/05-adapters.md)
- [19-cluster-deployment.md](../../docs/core/19-cluster-deployment.md)
