/**
 * BullMQ worker: `runtime.dispatch` hydrates definitions from Redis when `dynamicDefinitionsStore` is set.
 * Stack file (**`RUNTIME_CONFIG`**) supplies **wire settings**, **`llm`**, and optional **OpenClaw** disk skills
 * (see {@link loadStackRuntime}, {@link bootstrapOpenClawSkills}).
 */
import { createEngineQueue, createEngineWorker } from "@opencoreagents/adapters-bullmq";
import {
  RedisMemoryAdapter,
  RedisMessageBus,
  RedisRunStore,
} from "@opencoreagents/adapters-redis";
import {
  AgentRuntime,
  type EngineHookRunContext,
  type EngineJobPayload,
  type EngineRunJobPayload,
} from "@opencoreagents/core";
import type { PlannerEnqueueOptions } from "@opencoreagents/dynamic-planner";
import { loadStackRuntime } from "./config/stackSettings.js";
import { registerRuntimeArtifactTool } from "./runtime/artifactTool.js";
import { buildLlmStackFromConfig } from "./runtime/llmResolver.js";
import { registerRuntimeFetchRunTool } from "./runtime/fetchRunTool.js";
import { registerRuntimeInvokePlannerTool } from "./runtime/invokePlannerTool.js";
import { ensureDefaultPlannerAgent, registerRuntimeDynamicPlanner } from "./runtime/runtimePlanner.js";
import { buildVectorStackFromConfig } from "./runtime/vectorResolver.js";
import { runtimePackageVersion } from "./runtime/runtimeVersion.js";
import {
  RUNTIME_AGENT_ENGINE_DEFAULTS,
  bootstrapOpenClawSkills,
  createDefinitionsRedisStore,
  definitionsSyncOptions,
  openClawAgentRuntimeSlice,
} from "./runtime/runtimeShared.js";
import { redactRedisUrlForLog } from "./util/redactForLog.js";
import type { Job } from "bullmq";
import {
  createRedisRunEventHooks,
  extractInvokedByChatSessionIdFromJobPayload,
  publishRedisChatSessionNotify,
  publishRedisRunDispatchDone,
  publishRedisRunDispatchError,
} from "./redis/runEventRedis.js";

function hookCtxFromJobPayload(p: EngineJobPayload): EngineHookRunContext | null {
  if (p.kind === "run") {
    const rid = p.runId?.trim();
    if (!rid) return null;
    return { runId: rid, agentId: p.agentId, projectId: p.projectId, sessionId: p.sessionId };
  }
  return { runId: p.runId, agentId: p.agentId, projectId: p.projectId, sessionId: p.sessionId };
}

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
  const runStoreRedis = redis.duplicate();
  const producerRedis = redis.duplicate();
  const vectorRedis = redis.duplicate();
  const runEventsRedis = config.runEvents.redis ? redis.duplicate() : undefined;
  const messageBusRedis = redis.duplicate();

  const runStore = new RedisRunStore(runStoreRedis);
  const engineProducer = createEngineQueue(stack.engineQueueName, producerRedis);

  const enqueueRun = (payload: Omit<EngineRunJobPayload, "kind">, opts?: PlannerEnqueueOptions) =>
    engineProducer.addRun(payload, opts);

  await registerRuntimeDynamicPlanner({
    definitionsStore: store,
    runStore,
    enqueueRun,
    config,
  });
  await registerRuntimeArtifactTool(config.artifacts);

  await registerRuntimeInvokePlannerTool({
    definitionsStore: store,
    config,
    runStore,
    enqueueRun,
    defaultPlannerAgentId: config.planner.defaultAgent.id,
  });

  await registerRuntimeFetchRunTool({ runStore });

  const plannerSeed = await ensureDefaultPlannerAgent({
    store,
    projectId: stack.projectId,
    config,
  });
  if (plannerSeed.created) {
    console.log(
      `[opencoreagents-runtime] worker: seeded default planner agent in Redis id=${plannerSeed.id}`,
    );
  }

  const defaultEngineHooks = runEventsRedis
    ? createRedisRunEventHooks(runEventsRedis, stack.defKeyPrefix)
    : undefined;
  const vectorStack = buildVectorStackFromConfig(config, vectorRedis);

  const runtime = new AgentRuntime({
    llmAdapter,
    llmAdaptersByProvider,
    memoryAdapter: new RedisMemoryAdapter(memoryRedis),
    runStore,
    messageBus: new RedisMessageBus(messageBusRedis),
    ...vectorStack,
    ...RUNTIME_AGENT_ENGINE_DEFAULTS,
    ...openClawForRuntime,
    dynamicDefinitionsStore: store,
    dynamicDefinitionsSecrets: () => definitionsSyncOptions().secrets,
    defaultEngineHooks,
  });

  const worker = createEngineWorker(
    stack.engineQueueName,
    workerRedis,
    async (job: Job<EngineJobPayload, unknown, string>) => {
      try {
        const run = await runtime.dispatch(job.data);
        if (runEventsRedis) {
          publishRedisRunDispatchDone(runEventsRedis, stack.defKeyPrefix, run);
          const chatSid = extractInvokedByChatSessionIdFromJobPayload(job.data);
          if (chatSid) {
            publishRedisChatSessionNotify(runEventsRedis, stack.defKeyPrefix, chatSid, {
              kind: "planner_invocation_finished",
              plannerRunId: run.runId,
              plannerAgentId: run.agentId,
              plannerStatus: run.status,
              jobId: job.id != null ? String(job.id) : undefined,
            });
          }
        }
        return run;
      } catch (e) {
        if (runEventsRedis) {
          const ctx = hookCtxFromJobPayload(job.data);
          if (ctx) {
            publishRedisRunDispatchError(runEventsRedis, stack.defKeyPrefix, ctx, e);
          }
          const chatSid = extractInvokedByChatSessionIdFromJobPayload(job.data);
          if (chatSid) {
            const p = job.data;
            const plannerRunId =
              p.kind === "resume" || p.kind === "continue"
                ? p.runId
                : p.runId?.trim() || undefined;
            publishRedisChatSessionNotify(runEventsRedis, stack.defKeyPrefix, chatSid, {
              kind: "planner_invocation_failed",
              ...(plannerRunId !== undefined ? { plannerRunId } : {}),
              error: e instanceof Error ? e.message : String(e),
              jobId: job.id != null ? String(job.id) : undefined,
            });
          }
        }
        throw e;
      }
    },
  );

  const shutdown = async (signal: string) => {
    console.log(`${signal}, closing worker…`);
    await worker.close();
    await engineProducer.queue.close();
    await memoryRedis.quit();
    await runStoreRedis.quit();
    await producerRedis.quit();
    await vectorRedis.quit();
    await runEventsRedis?.quit();
    await messageBusRedis.quit();
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
    `[opencoreagents-runtime] worker version=${runtimePackageVersion} config=${configFile} queue=${stack.engineQueueName} redis=${redactRedisUrlForLog(stack.redisUrl)} defPrefix=${stack.defKeyPrefix} llm.defaultProvider=${config.llm.defaultProvider} vector.enabled=${config.vector.enabled ? "1" : "0"}${openclawNote}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
