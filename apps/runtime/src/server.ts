/**
 * HTTP: plan REST (`@opencoreagents/rest-api`) + Redis definition CRUD under `/v1`.
 * Workers run separately (`pnpm start:worker`).
 */
import { createEngineQueue } from "@opencoreagents/adapters-bullmq";
import { syncProjectDefinitionsToRegistry } from "@opencoreagents/dynamic-definitions";
import {
  createOptionalRuntimeRestApiKeyMiddleware,
  createRuntimeRestRouter,
} from "@opencoreagents/rest-api";
import { QueueEvents } from "bullmq";
import express from "express";
import { createDefinitionsAdminRouter } from "./definitionsAdminRouter.js";
import { loadStackRuntime } from "./stackSettings.js";
import { runtimePackageVersion } from "./runtimeVersion.js";
import {
  bootstrapOpenClawSkills,
  createDefinitionsRedisStore,
  definitionsSyncOptions,
  openClawAgentRuntimeSlice,
} from "./runtimeShared.js";

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

  const engine = createEngineQueue(engineQueueName, queueRedis);
  const queueEvents = new QueueEvents(engineQueueName, { connection: eventsRedis });
  await queueEvents.waitUntilReady();

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

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "opencoreagents-runtime-api",
      version: runtimePackageVersion,
      projectId,
      queue: engineQueueName,
    });
  });

  app.use(
    "/v1",
    restApiKeyAuth,
    createDefinitionsAdminRouter({
      store,
      projectId,
      onAfterMutation: resyncRegistry,
    }),
  );

  app.use(
    createRuntimeRestRouter({
      dispatch: {
        engine,
        queueEvents,
        jobWaitTimeoutMs: runWaitTimeoutMs,
      },
      projectId,
      resolveApiKey: () => resolveRestApiKey(),
      swagger: {
        info: {
          title: "OpenCore Agents runtime API",
          version: runtimePackageVersion,
          description:
            "Agent runs and jobs (plan REST), OpenAPI. Agent, skill, and HTTP tool definitions: /v1 (Redis-backed).",
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
    console.log(
      `[opencoreagents-runtime] routes: GET /health  GET|POST plan REST + /openapi.json + /docs  /v1/definitions …`,
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
    await redis.quit();
  };
  process.on("SIGINT", () => void close().then(() => process.exit(0)));
  process.on("SIGTERM", () => void close().then(() => process.exit(0)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
