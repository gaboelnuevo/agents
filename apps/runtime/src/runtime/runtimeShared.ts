import type Redis from "ioredis";
import { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import { httpToolSecretsFromEnv } from "../config/workerSecrets.js";
import { createRedis } from "../redis/redisClient.js";
import type { OpenClawBootstrapResult } from "./openclawBootstrap.js";

export { bootstrapOpenClawSkills } from "./openclawBootstrap.js";
export {
  RUNTIME_INVOKE_PLANNER_TOOL_ID,
  registerRuntimeInvokePlannerTool,
} from "./invokePlannerTool.js";
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

function resolvedMaxParseRecovery(): number {
  const raw = process.env.RUNTIME_ENGINE_MAX_PARSE_RECOVERY?.trim();
  if (raw === undefined || raw === "") {
    return 4;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return 4;
  }
  return Math.max(0, Math.min(20, Math.floor(n)));
}

/**
 * Same {@link AgentRuntime} limits as the worker. Keeps tuning in one place if the API ever runs dispatch in-process.
 *
 * **`maxParseRecovery`:** default **4** (vs core library **1**) so orchestrators and chat survive occasional
 * non-JSON turns from real models. Override with **`RUNTIME_ENGINE_MAX_PARSE_RECOVERY`** (integer **0–20**).
 */
export const RUNTIME_AGENT_ENGINE_DEFAULTS: {
  maxIterations: number;
  toolTimeoutMs: number;
  maxParseRecovery: number;
} = {
  maxIterations: 10,
  toolTimeoutMs: 15_000,
  maxParseRecovery: resolvedMaxParseRecovery(),
};

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
