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

  return `import type { RuntimeConfig } from "@agent-runtime/core";

export default {
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
} satisfies RuntimeConfig;
`;
}
