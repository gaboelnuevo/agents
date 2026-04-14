import Redis from "ioredis";

/**
 * Shared TCP Redis client. BullMQ requires `maxRetriesPerRequest: null` on ioredis.
 * Use `.duplicate()` for Queue / Worker / QueueEvents so connections do not share blocking state.
 *
 * @param url — e.g. from {@link resolveStackWireSettings}.`redisUrl` (YAML / env merge).
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
