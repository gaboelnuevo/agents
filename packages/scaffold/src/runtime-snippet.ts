import type { ScaffoldAdapterPreset, ScaffoldLlmPreset } from "./types.js";

export function buildRuntimeTs(opts: {
  adapter: ScaffoldAdapterPreset;
  llm: ScaffoldLlmPreset;
}): string {
  const { adapter, llm } = opts;

  const memoryBlock =
    adapter === "upstash"
      ? `    memory: {
      type: "upstash-redis",
      url: process.env.UPSTASH_REDIS_URL!,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    },`
      : adapter === "redis"
        ? `    memory: {
      type: "redis",
      url: process.env.REDIS_URL!,
    },`
        : `    memory: {
      type: "in-memory",
    },`;

  const vectorBlock =
    adapter === "upstash"
      ? `    vector: {
      type: "upstash-vector",
      url: process.env.UPSTASH_VECTOR_URL,
      token: process.env.UPSTASH_VECTOR_TOKEN,
    },`
      : `    vector: {
      type: "in-memory",
    },`;

  const llmBlock =
    llm === "openai"
      ? `  llm: {
    provider: "openai",
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY!,
  },`
      : llm === "anthropic"
        ? `  llm: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },`
        : `  llm: {
    provider: "custom",
    model: process.env.CUSTOM_LLM_MODEL ?? "custom",
    apiKey: process.env.CUSTOM_LLM_API_KEY ?? "",
  },`;

  const imports: string[] = [
    `import type { RuntimeConfig } from "@agent-runtime/core";`,
    `import { AgentRuntime, InMemoryMemoryAdapter } from "@agent-runtime/core";`,
  ];

  let memoryInit: string;
  if (adapter === "redis") {
    imports.push(`import Redis from "ioredis";`);
    imports.push(`import { RedisMemoryAdapter } from "@agent-runtime/adapters-redis";`);
    memoryInit = `const redis = new Redis(process.env.REDIS_URL!);
  const memoryAdapter = new RedisMemoryAdapter(redis);`;
  } else if (adapter === "upstash") {
    imports.push(`import { UpstashRedisMemoryAdapter } from "@agent-runtime/adapters-upstash";`);
    memoryInit = `const memoryAdapter = new UpstashRedisMemoryAdapter(
    process.env.UPSTASH_REDIS_URL!,
    process.env.UPSTASH_REDIS_TOKEN!,
  );`;
  } else {
    memoryInit = `const memoryAdapter = new InMemoryMemoryAdapter();`;
  }

  const createAgentRuntimeFn =
    llm === "openai"
      ? `export function createAgentRuntime(): AgentRuntime {
  ${memoryInit}
  const llmAdapter = new OpenAILLMAdapter(process.env.OPENAI_API_KEY!);
  return new AgentRuntime({
    llmAdapter,
    memoryAdapter,
    maxIterations: config.limits.maxIterations,
    runTimeoutMs: config.limits.runTimeoutMs,
    ...(config.allowedToolIds != null && config.allowedToolIds !== "*"
      ? { allowedToolIds: config.allowedToolIds }
      : {}),
  });
}`
      : `export function createAgentRuntime(): AgentRuntime {
  throw new Error(
    "Implement createAgentRuntime(): construct new AgentRuntime({ llmAdapter, memoryAdapter, ... }) for your LLM provider.",
  );
}`;

  if (llm === "openai") {
    imports.push(`import { OpenAILLMAdapter } from "@agent-runtime/adapters-openai";`);
  }

  const configDecl = `const config = {
  adapters: {
${memoryBlock}
${vectorBlock}
    jobQueue: {
      type: "bullmq",
      connection: process.env.REDIS_URL,
    },
  },
${llmBlock}
  security: {
    enabled: true,
    defaultRoles: ["agent"],
  },
  limits: {
    maxIterations: 25,
    runTimeoutMs: 120_000,
  },
  allowedToolIds: "*" as const,
} satisfies RuntimeConfig;

export default config;`;

  return `${imports.join("\n")}

${configDecl}

${createAgentRuntimeFn}
`;
}
