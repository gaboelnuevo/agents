/**
 * Detects TTL expiry from BullMQ **`Job.waitUntilFinished(queueEvents, ttl)`** — the library rejects with
 * a message starting with **`Job wait `** and containing **`timed out before finishing`** (see **`bullmq`** `classes/job`).
 */
export function isBullmqJobWaitTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith("Job wait ") && msg.includes("timed out before finishing");
}
