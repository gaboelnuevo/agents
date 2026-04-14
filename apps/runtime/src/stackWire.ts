import { DEFAULT_ENGINE_QUEUE_NAME } from "@opencoreagents/adapters-bullmq";
import type { ResolvedRuntimeStackConfig } from "./types.js";

/**
 * Values wired into server, worker, and Redis after merging **stack YAML/JSON** with optional
 * **`process.env` overrides** (non-empty env wins for operational keys).
 */
export interface StackWireSettings {
  port: number;
  projectId: string;
  redisUrl: string;
  defKeyPrefix: string;
  engineQueueName: string;
  runWaitTimeoutMs: number;
}

function parsePortEnv(): number | undefined {
  const raw = process.env.PORT?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function envTrim(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Derive listen port, Redis URL, queue name, etc. **Primary source:** merged `config` from
 * {@link loadRuntimeConfig}. **Overrides:** when these env vars are set and non-empty, they replace
 * the YAML value: `PORT`, `PROJECT_ID`, `REDIS_URL`, `DEF_KEY_PREFIX`, `ENGINE_QUEUE_NAME`,
 * `RUN_WAIT_TIMEOUT_MS` (or legacy `RUN_SYNC_TIMEOUT_MS`).
 */
export function resolveStackWireSettings(config: ResolvedRuntimeStackConfig): StackWireSettings {
  const port = parsePortEnv() ?? config.server.port;

  const projectId = envTrim("PROJECT_ID") ?? config.project.id;

  const redisUrl = envTrim("REDIS_URL") ?? config.redis.url;

  const defKeyPrefix =
    envTrim("DEF_KEY_PREFIX")?.replace(/:+$/, "") ??
    config.definitions.keyPrefix.replace(/:+$/, "");

  const qEnv = envTrim("ENGINE_QUEUE_NAME");
  const qYaml = config.bullmq.queueName?.trim();
  const engineQueueName = qEnv || qYaml || DEFAULT_ENGINE_QUEUE_NAME;

  const waitRaw = process.env.RUN_WAIT_TIMEOUT_MS ?? process.env.RUN_SYNC_TIMEOUT_MS;
  let runWaitTimeoutMs = config.run.waitTimeoutMs;
  if (waitRaw?.trim()) {
    const n = Number(waitRaw);
    if (Number.isFinite(n)) runWaitTimeoutMs = n;
  }

  return {
    port,
    projectId,
    redisUrl,
    defKeyPrefix,
    engineQueueName,
    runWaitTimeoutMs,
  };
}
