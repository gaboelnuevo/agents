/**
 * HTTP: plan REST (`@opencoreagents/rest-api`) + Redis definition CRUD under `/v1`.
 * Workers run separately (`pnpm start:worker`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineQueue } from "@opencoreagents/adapters-bullmq";
import {
  RedisMemoryAdapter,
  RedisMessageBus,
  RedisRunStore,
} from "@opencoreagents/adapters-redis";
import { AgentRuntime, type EngineRunJobPayload } from "@opencoreagents/core";
import { syncProjectDefinitionsToRegistry } from "@opencoreagents/dynamic-definitions";
import type { PlannerEnqueueOptions } from "@opencoreagents/dynamic-planner";
import {
  createOptionalRuntimeRestApiKeyMiddleware,
  createRuntimeRestRouter,
} from "@opencoreagents/rest-api";
import { QueueEvents } from "bullmq";
import express from "express";
import { loadStackRuntime } from "./config/stackSettings.js";
import { extendOpenApiWithChat } from "./http/chatOpenApi.js";
import { extendOpenApiWithDefinitionsAdmin } from "./http/definitionsAdminOpenApi.js";
import { createDefinitionsAdminRouter } from "./http/definitionsAdminRouter.js";
import { createChatRouter } from "./http/chatRouter.js";
import { createChatSessionStreamRouter } from "./http/chatSessionStreamRouter.js";
import { createRunEventsStreamRouter } from "./http/runEventsStreamRouter.js";
import { buildLlmStackFromConfig } from "./runtime/llmResolver.js";
import { registerRuntimeFetchRunTool } from "./runtime/fetchRunTool.js";
import { registerRuntimeInvokePlannerTool } from "./runtime/invokePlannerTool.js";
import { ensureDefaultPlannerAgent, registerRuntimeDynamicPlanner } from "./runtime/runtimePlanner.js";
import { runtimePackageVersion } from "./runtime/runtimeVersion.js";
import {
  RUNTIME_AGENT_ENGINE_DEFAULTS,
  bootstrapOpenClawSkills,
  createDefinitionsRedisStore,
  definitionsSyncOptions,
  openClawAgentRuntimeSlice,
} from "./runtime/runtimeShared.js";
import { isChatEndpointAvailable } from "./runtime/runtimeChat.js";

const runtimePublicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");

function resolveRestApiKey(): string | undefined {
  return process.env.REST_API_KEY?.trim();
}

/**
 * Without a REST API key, bind loopback only so the HTTP surface is not reachable from other machines.
 * With a key, use the stack `server.host` (e.g. 0.0.0.0 in Docker). Override with OPENCORE_INSECURE_PUBLIC_HTTP=1 only for local lab use.
 */
function resolveHttpListenHost(stackHost: string): string {
  if (process.env.OPENCORE_INSECURE_PUBLIC_HTTP === "1") {
    console.warn(
      "[opencoreagents-runtime] OPENCORE_INSECURE_PUBLIC_HTTP=1: listening on all interfaces without requiring REST_API_KEY (insecure)",
    );
    return stackHost;
  }
  if (resolveRestApiKey()) {
    return stackHost;
  }
  return "127.0.0.1";
}

async function main(): Promise<void> {
  const { config, stack, configFile } = loadStackRuntime();
  const { port, projectId, redisUrl, defKeyPrefix, engineQueueName, runWaitTimeoutMs } = stack;
  const listenHost = resolveHttpListenHost(config.server.host);

  const openclaw = await bootstrapOpenClawSkills({
    enabled: config.openclaw.enabled,
    skillsDirs: config.openclaw.skillsDirs,
    projectId,
  });
  /** When this process constructs AgentRuntime (in-process dispatch), spread `openClawForRuntime` like `worker.ts` plus `RUNTIME_AGENT_ENGINE_DEFAULTS` from `./runtimeShared.js`. */
  const openClawForRuntime = openClawAgentRuntimeSlice(openclaw);

  const { redis, store } = createDefinitionsRedisStore(redisUrl, defKeyPrefix);
  const queueRedis = redis.duplicate();
  const eventsRedis = redis.duplicate();
  const runStoreRedis = redis.duplicate();
  const runEventsStreamRedis = config.runEvents.redis ? redis.duplicate() : undefined;
  const apiMemoryRedis = redis.duplicate();
  const apiMessageBusRedis = redis.duplicate();

  const runStore = new RedisRunStore(runStoreRedis);

  const { llmAdapter, llmAdaptersByProvider } = buildLlmStackFromConfig(config.llm);
  const agentRuntimeForRest = new AgentRuntime({
    llmAdapter,
    llmAdaptersByProvider,
    memoryAdapter: new RedisMemoryAdapter(apiMemoryRedis),
    runStore,
    messageBus: new RedisMessageBus(apiMessageBusRedis),
    ...RUNTIME_AGENT_ENGINE_DEFAULTS,
    ...openClawForRuntime,
  });

  const engine = createEngineQueue(engineQueueName, queueRedis);
  const queueEvents = new QueueEvents(engineQueueName, { connection: eventsRedis });
  await queueEvents.waitUntilReady();
  const enqueueRun = (payload: Omit<EngineRunJobPayload, "kind">, opts?: PlannerEnqueueOptions) =>
    engine.addRun(payload, opts);

  await registerRuntimeDynamicPlanner({
    definitionsStore: store,
    runStore,
    enqueueRun,
    config,
  });

  await registerRuntimeInvokePlannerTool({
    definitionsStore: store,
    config,
    runStore,
    enqueueRun,
    defaultPlannerAgentId: config.planner.defaultAgent.id,
  });

  await registerRuntimeFetchRunTool({ runStore });

  const plannerSeed = await ensureDefaultPlannerAgent({ store, projectId, config });
  if (plannerSeed.created) {
    console.log(
      `[opencoreagents-runtime] seeded default planner agent in Redis: id=${plannerSeed.id} (tune via stack planner.defaultAgent / env — id planner is not mutable via PUT /v1/agents)`,
    );
  }

  const syncOpts = definitionsSyncOptions();
  async function resyncRegistry(): Promise<void> {
    await syncProjectDefinitionsToRegistry(store, projectId, syncOpts);
  }
  await resyncRegistry();

  const app = express();
  app.disable("x-powered-by");

  const restApiKeyAuth = createOptionalRuntimeRestApiKeyMiddleware({
    resolveApiKey: () => resolveRestApiKey(),
  });

  app.get("/health", (req, res) => {
    const base = {
      ok: true,
      service: "opencoreagents-runtime-api",
      version: runtimePackageVersion,
    };
    const details =
      req.query.details === "1" ||
      req.query.details === "true" ||
      (typeof req.query.details === "string" && req.query.details.toLowerCase() === "yes");
    if (details) {
      res.json({
        ...base,
        projectId,
        queue: engineQueueName,
      });
      return;
    }
    res.json(base);
  });

  app.get("/", (_req, res) => {
    res.redirect(302, "/ui/");
  });

  app.use("/ui", express.static(runtimePublicDir, { index: "index.html", extensions: ["html"] }));

  app.use(
    "/v1",
    restApiKeyAuth,
    createDefinitionsAdminRouter({
      store,
      projectId,
      onAfterMutation: resyncRegistry,
    }),
  );

  if (isChatEndpointAvailable(config)) {
    app.use(
      "/v1",
      restApiKeyAuth,
      createChatRouter({
        store,
        redis,
        projectId,
        definitionsKeyPrefix: defKeyPrefix,
        engine,
        queueEvents,
        runStore,
        jobWaitTimeoutMs: runWaitTimeoutMs,
        config,
        onAfterAgentCreated: resyncRegistry,
      }),
    );
  }

  if (runEventsStreamRedis && isChatEndpointAvailable(config)) {
    app.use(
      "/v1",
      restApiKeyAuth,
      createChatSessionStreamRouter({
        redis: runEventsStreamRedis,
        projectId,
        definitionsKeyPrefix: defKeyPrefix,
      }),
    );
  }

  if (runEventsStreamRedis) {
    app.use(
      "/v1",
      restApiKeyAuth,
      createRunEventsStreamRouter({
        redis: runEventsStreamRedis,
        runStore,
        projectId,
        definitionsKeyPrefix: defKeyPrefix,
      }),
    );
  }

  app.use(
    createRuntimeRestRouter({
      dispatch: {
        engine,
        queueEvents,
        jobWaitTimeoutMs: runWaitTimeoutMs,
      },
      runtime: agentRuntimeForRest,
      runStore,
      projectId,
      resolveApiKey: () => resolveRestApiKey(),
      swagger: {
        info: {
          title: "OpenCore Agents runtime API",
          version: runtimePackageVersion,
          description:
            "Agent runs and jobs (plan REST), OpenAPI. Definition CRUD: `/v1/definitions` and `PUT /v1/agents|skills|http-tools/...` (Redis-backed). Chat: `/v1/chat` when enabled in stack.",
        },
        extendOpenApi: (spec) => {
          let s = extendOpenApiWithDefinitionsAdmin(spec);
          if (isChatEndpointAvailable(config)) {
            s = extendOpenApiWithChat(s, {
              includePlannerNotifyStream: Boolean(runEventsStreamRedis),
            });
          }
          return s;
        },
      },
    }),
  );

  const server = app.listen(port, listenHost, () => {
    const authMode = resolveRestApiKey() ? "REST_API_KEY=on" : "REST_API_KEY=off";
    const bindNote =
      listenHost === "127.0.0.1"
        ? " (loopback only — set REST_API_KEY to listen on stack server.host for remote access)"
        : "";
    const openclawNote = openClawForRuntime.defaultSkillIdsGlobal.length
      ? ` openclawSkills=${openClawForRuntime.defaultSkillIdsGlobal.length}`
      : "";
    console.log(
      `[opencoreagents-runtime] listening=http://${listenHost}:${port}${bindNote} version=${runtimePackageVersion} projectId=${projectId} queue=${engineQueueName} config=${configFile} ${authMode}${openclawNote}`,
    );
    const chatNote = isChatEndpointAvailable(config) ? "  POST /v1/chat" : "";
    const chatSseNote =
      runEventsStreamRedis && isChatEndpointAvailable(config)
        ? "  GET /v1/chat/stream?sessionId= (SSE planner notify)"
        : "";
    const sseNote = runEventsStreamRedis ? "  GET /v1/runs/:runId/stream?sessionId= (SSE run events)" : "";
    console.log(
      `[opencoreagents-runtime] routes: GET /ui (playground)  GET /health (?details=1 for projectId+queue)  GET|POST plan REST + /openapi.json + /docs  GET /sessions/:sessionId/status (?light=1)  GET /runs/:id?timeline=1  /v1/definitions …${chatNote}${chatSseNote}${sseNote}`,
    );
    console.log(`[opencoreagents-runtime] start worker: pnpm start:worker (same RUNTIME_CONFIG / stack file)`);
  });

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await queueEvents.close();
    await engine.queue.close();
    await eventsRedis.quit();
    await queueRedis.quit();
    await runStoreRedis.quit();
    await runEventsStreamRedis?.quit();
    await apiMemoryRedis.quit();
    await apiMessageBusRedis.quit();
    await redis.quit();
  };
  process.on("SIGINT", () => void close().then(() => process.exit(0)));
  process.on("SIGTERM", () => void close().then(() => process.exit(0)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
