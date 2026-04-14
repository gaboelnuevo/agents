import type { ResolvedRuntimeStackConfig, RuntimeStackFileConfig } from "./types.js";

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
  llm: {
    defaultProvider: "openai",
    openai: { apiKey: "", baseUrl: "" },
    anthropic: { apiKey: "", baseUrl: "" },
  },
};

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
  };
}
