import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import type {
  EngineJobPayload,
  EngineResumeJobPayload,
  EngineRunJobPayload,
} from "./types.js";

export type EngineQueue = {
  queue: Queue<EngineJobPayload, unknown, string>;
  addRun: (
    payload: Omit<EngineRunJobPayload, "kind">,
    opts?: JobsOptions,
  ) => ReturnType<Queue<EngineJobPayload>["add"]>;
  addResume: (
    payload: Omit<EngineResumeJobPayload, "kind">,
    opts?: JobsOptions,
  ) => ReturnType<Queue<EngineJobPayload>["add"]>;
};

/**
 * Typed {@link Queue} helpers for enqueueing engine runs and resumes (e.g. from an API or after a webhook).
 */
export function createEngineQueue(
  queueName: string,
  connection: ConnectionOptions,
): EngineQueue {
  const queue = new Queue<EngineJobPayload>(queueName, { connection });
  return {
    queue,
    addRun: (body, opts) => queue.add("run", { kind: "run", ...body }, opts),
    addResume: (body, opts) => queue.add("resume", { kind: "resume", ...body }, opts),
  };
}
