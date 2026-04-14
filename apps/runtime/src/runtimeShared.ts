import type Redis from "ioredis";
import { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import { createRedis } from "./redisClient.js";
import { httpToolSecretsFromEnv } from "./workerSecrets.js";
import type { OpenClawBootstrapResult } from "./openclawBootstrap.js";

export { bootstrapOpenClawSkills } from "./openclawBootstrap.js";
export type { OpenClawBootstrapResult } from "./openclawBootstrap.js";

/**
 * Slice for **`new AgentRuntime({ … })`**: same OpenClaw ids the worker passes as **`defaultSkillIdsGlobal`**.
 * Use on the API process too if you add in-process **`dispatch`** / **`Agent.load`** — must match the worker or skill merge diverges.
 */
export function openClawAgentRuntimeSlice(result: OpenClawBootstrapResult): {
  defaultSkillIdsGlobal: readonly string[];
} {
  return { defaultSkillIdsGlobal: result.defaultSkillIdsGlobal };
}

/**
 * Same {@link AgentRuntime} limits as the worker. Keeps tuning in one place if the API ever runs dispatch in-process.
 */
export const RUNTIME_AGENT_ENGINE_DEFAULTS = {
  maxIterations: 10,
  toolTimeoutMs: 15_000,
} as const;

export interface DefinitionsStoreConnections {
  /** Primary Redis client backing {@link RedisDynamicDefinitionsStore}. */
  redis: Redis;
  store: RedisDynamicDefinitionsStore;
}

/**
 * Primary Redis + `RedisDynamicDefinitionsStore` — identical wiring in **`server.ts`** and **`worker.ts`**.
 * Duplicate **`redis`** for BullMQ (`Queue` / `Worker` / `QueueEvents`) or **`RedisMemoryAdapter`**.
 */
export function createDefinitionsRedisStore(
  redisUrl: string,
  defKeyPrefix: string,
): DefinitionsStoreConnections {
  const redis = createRedis(redisUrl);
  const store = new RedisDynamicDefinitionsStore(redis, { keyPrefix: defKeyPrefix });
  return { redis, store };
}

/**
 * Options for **`syncProjectDefinitionsToRegistry`** (API) and **`hydrateAgentDefinitionsFromStore`** (worker):
 * same **`HTTP_TOOL_SECRETS_JSON`** pipeline in both processes.
 */
export function definitionsSyncOptions(): { secrets: Record<string, string> } {
  return { secrets: httpToolSecretsFromEnv() };
}
