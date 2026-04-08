import { Worker, type ConnectionOptions, type Processor, type WorkerOptions } from "bullmq";
import type { EngineJobPayload } from "./types.js";

/** Default queue name — override in production for env-specific namespacing. */
export const DEFAULT_ENGINE_QUEUE_NAME = "agent-engine-runs";

/**
 * BullMQ {@link Worker} that receives {@link EngineJobPayload} jobs.
 * The `processor` typically calls {@link dispatchEngineJob} or your own `buildEngineDeps` + `executeRun` flow.
 */
export function createEngineWorker(
  queueName: string,
  connection: ConnectionOptions,
  processor: Processor<EngineJobPayload>,
  workerOpts?: Omit<WorkerOptions, "connection">,
): Worker<EngineJobPayload, unknown, string> {
  return new Worker<EngineJobPayload>(queueName, processor, {
    connection,
    ...workerOpts,
  });
}
