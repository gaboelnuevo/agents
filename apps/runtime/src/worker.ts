/**
 * BullMQ worker: `runtime.dispatch` hydrates definitions from Redis when `dynamicDefinitionsStore` is set.
 * Stack file (**`RUNTIME_CONFIG`**) supplies **wire settings**, **`llm`**, and optional **OpenClaw** disk skills
 * (see {@link loadStackRuntime}, {@link bootstrapOpenClawSkills}).
 */
import { createEngineWorker } from "@opencoreagents/adapters-bullmq";
import { RedisMemoryAdapter } from "@opencoreagents/adapters-redis";
import { AgentRuntime } from "@opencoreagents/core";
import { buildLlmStackFromConfig } from "./llmResolver.js";
import { redactRedisUrlForLog } from "./redactForLog.js";
import { runtimePackageVersion } from "./runtimeVersion.js";
import { loadStackRuntime } from "./stackSettings.js";
import {
  RUNTIME_AGENT_ENGINE_DEFAULTS,
  bootstrapOpenClawSkills,
  createDefinitionsRedisStore,
  definitionsSyncOptions,
  openClawAgentRuntimeSlice,
} from "./runtimeShared.js";

async function main(): Promise<void> {
  const { config, configFile, stack } = loadStackRuntime();
  const { llmAdapter, llmAdaptersByProvider } = buildLlmStackFromConfig(config.llm);

  const openclaw = await bootstrapOpenClawSkills({
    enabled: config.openclaw.enabled,
    skillsDirs: config.openclaw.skillsDirs,
    projectId: stack.projectId,
  });

  const openClawForRuntime = openClawAgentRuntimeSlice(openclaw);

  const { redis, store } = createDefinitionsRedisStore(stack.redisUrl, stack.defKeyPrefix);
  const workerRedis = redis.duplicate();
  const memoryRedis = redis.duplicate();

  const runtime = new AgentRuntime({
    llmAdapter,
    llmAdaptersByProvider,
    memoryAdapter: new RedisMemoryAdapter(memoryRedis),
    ...RUNTIME_AGENT_ENGINE_DEFAULTS,
    ...openClawForRuntime,
    dynamicDefinitionsStore: store,
    dynamicDefinitionsSecrets: () => definitionsSyncOptions().secrets,
  });

  const worker = createEngineWorker(stack.engineQueueName, workerRedis, async (job) => {
    return runtime.dispatch(job.data);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal}, closing worker…`);
    await worker.close();
    await memoryRedis.quit();
    await redis.quit();
    await workerRedis.quit();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const openclawNote = openClawForRuntime.defaultSkillIdsGlobal.length
    ? ` openclawSkills=${openClawForRuntime.defaultSkillIdsGlobal.length}`
    : "";
  console.log(
    `[opencoreagents-runtime] worker version=${runtimePackageVersion} config=${configFile} queue=${stack.engineQueueName} redis=${redactRedisUrlForLog(stack.redisUrl)} defPrefix=${stack.defKeyPrefix} llm.defaultProvider=${config.llm.defaultProvider}${openclawNote}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
