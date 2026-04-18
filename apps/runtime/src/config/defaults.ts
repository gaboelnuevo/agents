import type { LlmDriverKind, ResolvedRuntimeStackConfig, RuntimeStackFileConfig } from "./types.js";

function isAutoOrEmptyToken(s: string): boolean {
  return s === "" || s.toLowerCase() === "auto";
}

/** `auto` / empty → undefined (runtime infers). */
function normalizePlannerSubAgentModel(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (isAutoOrEmptyToken(s)) return undefined;
  return s;
}

function normalizePlannerSubAgentProvider(v: unknown): LlmDriverKind | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (isAutoOrEmptyToken(s)) return undefined;
  if (s === "openai" || s === "anthropic") return s;
  throw new Error(
    `Invalid planner provider: "${String(v).trim()}" (expected openai, anthropic, or auto)`,
  );
}

function normalizeDefaultPlannerAgentId(v: unknown): string {
  if (v == null) return "planner";
  const s = String(v).trim();
  if (s === "" || isAutoOrEmptyToken(s)) return "planner";
  return s;
}

function normalizeDefaultChatAgentId(v: unknown): string {
  if (v == null) return "chat";
  const s = String(v).trim();
  if (s === "" || isAutoOrEmptyToken(s)) return "chat";
  return s;
}

export const defaultStackConfig: ResolvedRuntimeStackConfig = {
  environment: "local",
  server: { port: 3010, host: "0.0.0.0" },
  project: { id: "default" },
  redis: { url: "redis://127.0.0.1:6379" },
  bullmq: { queueName: undefined },
  definitions: { keyPrefix: "def" },
  run: { waitTimeoutMs: 60_000 },
  /** Default on: scan `./skills` relative to the stack file (use `../skills` in config/*.yaml when skills live in `apps/runtime/skills`). */
  openclaw: { enabled: true, skillsDirs: ["./skills"] },
  artifacts: { enabled: true, rootDir: "./artifacts", publicBaseUrl: "/artifacts" },
  llm: {
    defaultProvider: "openai",
    openai: { apiKey: "", baseUrl: "" },
    anthropic: { apiKey: "", baseUrl: "" },
  },
  planner: {
    defaultAgent: {
      enabled: true,
      id: "planner",
      llm: {},
    },
    subAgent: {},
  },
  runEvents: { redis: true },
  chat: {
    defaultAgent: {
      enabled: true,
      id: "chat",
      llm: {},
    },
  },
};

function mergeRunEventsRedis(raw: RuntimeStackFileConfig): boolean {
  const v = process.env.RUNTIME_RUN_EVENTS_REDIS?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  // Omit runEvents.redis in YAML → default on (matches defaultStackConfig; Redis stacks get SSE without extra keys).
  return raw.runEvents?.redis ?? defaultStackConfig.runEvents.redis;
}

export function mergeWithDefaults(raw: RuntimeStackFileConfig): ResolvedRuntimeStackConfig {
  return {
    environment: raw.environment ?? defaultStackConfig.environment,
    server: {
      port: raw.server?.port ?? defaultStackConfig.server.port,
      host: raw.server?.host ?? defaultStackConfig.server.host,
    },
    project: {
      id: raw.project?.id ?? defaultStackConfig.project.id,
    },
    redis: {
      url: raw.redis?.url ?? defaultStackConfig.redis.url,
    },
    bullmq: {
      queueName:
        raw.bullmq?.queueName === undefined
          ? defaultStackConfig.bullmq.queueName
          : raw.bullmq.queueName === ""
            ? undefined
            : raw.bullmq.queueName,
    },
    definitions: {
      keyPrefix: raw.definitions?.keyPrefix ?? defaultStackConfig.definitions.keyPrefix,
    },
    run: {
      waitTimeoutMs: raw.run?.waitTimeoutMs ?? defaultStackConfig.run.waitTimeoutMs,
    },
    openclaw: {
      enabled: raw.openclaw?.enabled ?? defaultStackConfig.openclaw.enabled,
      skillsDirs: raw.openclaw?.skillsDirs ?? defaultStackConfig.openclaw.skillsDirs,
    },
    artifacts: {
      enabled: raw.artifacts?.enabled ?? defaultStackConfig.artifacts.enabled,
      rootDir: raw.artifacts?.rootDir ?? defaultStackConfig.artifacts.rootDir,
      publicBaseUrl:
        raw.artifacts?.publicBaseUrl ?? defaultStackConfig.artifacts.publicBaseUrl,
    },
    llm: {
      defaultProvider: raw.llm?.defaultProvider ?? defaultStackConfig.llm.defaultProvider,
      openai: {
        apiKey: raw.llm?.openai?.apiKey ?? defaultStackConfig.llm.openai.apiKey,
        baseUrl: raw.llm?.openai?.baseUrl ?? defaultStackConfig.llm.openai.baseUrl,
      },
      anthropic: {
        apiKey: raw.llm?.anthropic?.apiKey ?? defaultStackConfig.llm.anthropic.apiKey,
        baseUrl: raw.llm?.anthropic?.baseUrl ?? defaultStackConfig.llm.anthropic.baseUrl,
      },
    },
    planner: {
      defaultAgent: {
        enabled: raw.planner?.defaultAgent?.enabled !== false,
        id: normalizeDefaultPlannerAgentId(raw.planner?.defaultAgent?.id),
        llm: {
          provider: normalizePlannerSubAgentProvider(raw.planner?.defaultAgent?.llm?.provider),
          model: normalizePlannerSubAgentModel(raw.planner?.defaultAgent?.llm?.model),
          temperature:
            typeof raw.planner?.defaultAgent?.llm?.temperature === "number"
              ? raw.planner.defaultAgent.llm.temperature
              : undefined,
        },
      },
      subAgent: {
        provider: normalizePlannerSubAgentProvider(raw.planner?.subAgent?.provider),
        model: normalizePlannerSubAgentModel(raw.planner?.subAgent?.model),
        temperature:
          typeof raw.planner?.subAgent?.temperature === "number"
            ? raw.planner.subAgent.temperature
            : undefined,
      },
    },
    runEvents: {
      redis: mergeRunEventsRedis(raw),
    },
    chat: {
      defaultAgent: {
        enabled: raw.chat?.defaultAgent?.enabled !== false,
        id: normalizeDefaultChatAgentId(raw.chat?.defaultAgent?.id),
        llm: {
          provider: normalizePlannerSubAgentProvider(raw.chat?.defaultAgent?.llm?.provider),
          model: normalizePlannerSubAgentModel(raw.chat?.defaultAgent?.llm?.model),
          temperature:
            typeof raw.chat?.defaultAgent?.llm?.temperature === "number"
              ? raw.chat.defaultAgent.llm.temperature
              : undefined,
        },
      },
    },
  };
}
