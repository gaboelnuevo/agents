# `@agent-runtime/adapters-bullmq`

**Priority integration** for background work: typed BullMQ **queue** / **worker** helpers and **`dispatchEngineJob`** so workers call the same **`Agent.run`** / **`Agent.resume`** path as the SDK.

Requires the same worker bootstrap as any engine process: construct **`AgentRuntime`** with shared adapters, then **`Tool.define` / `Skill.define` / `Agent.define`** before processing jobs.

## Exports

- **`createEngineQueue`** — enqueue `run` / `resume` jobs with typed payloads
- **`createEngineWorker`** — `Worker` that receives **`EngineJobPayload`**
- **`dispatchEngineJob(runtime, payload)`** — `Agent.load` → `run` or `resume` for one job payload
- **`DEFAULT_ENGINE_QUEUE_NAME`** — default queue name string (`agent-engine-runs`)

## Usage

Use the **same queue name** and **connection** for producers and consumers. After **`AgentRuntime`** construction and **`Agent.define`** (worker process):

```typescript
import { AgentRuntime } from "@agent-runtime/core";
import {
  DEFAULT_ENGINE_QUEUE_NAME,
  createEngineQueue,
  createEngineWorker,
  dispatchEngineJob,
} from "@agent-runtime/adapters-bullmq";

const connection = { url: process.env.REDIS_URL! };

const runtime = new AgentRuntime({
  // llmAdapter, memoryAdapter, runStore?, messageBus?, …
});

const { addRun, addResume } = createEngineQueue(DEFAULT_ENGINE_QUEUE_NAME, connection);

// API process: enqueue a new run
await addRun({
  projectId: "my-project",
  agentId: "support-bot",
  sessionId: "sess-1",
  userInput: "Hello",
});

// Worker process
createEngineWorker(DEFAULT_ENGINE_QUEUE_NAME, connection, async (job) => {
  await dispatchEngineJob(runtime, job.data);
});
```

For **`resume`** after a `wait`, use **`addResume`** with `runId` and **`resumeInput`** (`{ type, content }`). Delayed jobs: pass BullMQ **`JobsOptions`** (e.g. `delay`) as the second argument to **`addRun`** / **`addResume`**.

## Testing

- **Unit:** `dispatchEngineJob` with in-memory runtime — `tests/dispatch.test.ts`.
- **Integration (Redis):** `tests/redis-queue.integration.test.ts` runs only when **`REDIS_INTEGRATION=1`** (set in CI with a Redis service). Locally: start Redis on `REDIS_HOST` / `REDIS_PORT` (defaults `127.0.0.1:6379`) and run with that env var.

## Docs

- [05-adapters.md](../../docs/core/05-adapters.md#job-queue-adapter-primary-bullmq) — BullMQ is the primary job-queue pattern
- [19-cluster-deployment.md](../../docs/core/19-cluster-deployment.md) §4 — cluster execution model
