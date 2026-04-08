import { buildRuntimeTs } from "../runtime-snippet.js";
import type { InitProjectOptions } from "../types.js";

export function defaultTemplateFiles(opts: {
  name: string;
  adapter: NonNullable<InitProjectOptions["adapter"]>;
  llm: NonNullable<InitProjectOptions["llm"]>;
  packageManager: NonNullable<InitProjectOptions["packageManager"]>;
}): Record<string, string> {
  const { name, adapter, llm, packageManager } = opts;
  const pmRun = packageManager === "yarn" ? "yarn" : `${packageManager} run`;

  return {
    "package.json": JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        scripts: {
          dev: "tsx watch src/index.ts",
          test: "vitest run",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@agent-runtime/core": "^0.0.0",
          ...(llm === "openai" ? { "@agent-runtime/adapters-openai": "^0.0.0" } : {}),
          ...(adapter === "redis"
            ? { "@agent-runtime/adapters-redis": "^0.0.0", ioredis: "^5" }
            : {}),
          ...(adapter === "upstash" ? { "@agent-runtime/adapters-upstash": "^0.0.0" } : {}),
        },
        devDependencies: {
          "@types/node": "^22",
          tsx: "^4",
          typescript: "^5.7",
          vitest: "^3",
        },
        packageManager:
          packageManager === "pnpm"
            ? "pnpm@9.15.4"
            : packageManager === "yarn"
              ? "yarn@1.22.22"
              : undefined,
      },
      null,
      2,
    ),

    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          outDir: "dist",
          rootDir: ".",
        },
        include: ["agents/**/*.ts", "tools/**/*.ts", "skills/**/*.ts", "config/**/*.ts", "src/**/*.ts", "tests/**/*.ts"],
      },
      null,
      2,
    ),

    ".env.example": `# Copy to .env and fill values
# LLM
OPENAI_API_KEY=

# Upstash Redis (memory) — when using adapter preset "upstash"
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# Optional vector
UPSTASH_VECTOR_URL=
UPSTASH_VECTOR_TOKEN=

# Job queue / Redis URL (BullMQ)
REDIS_URL=
`,

    "config/runtime.ts": buildRuntimeTs({ adapter, llm }),

    "config/security.ts": `export default {
  enabled: true,
  defaultRoles: ["agent"],
};
`,

    "agents/example-agent.ts": `import { Agent, Session, type AgentRuntime, type SessionOptions } from "@agent-runtime/core";

const SYSTEM = ${JSON.stringify(
      "You are a helpful assistant. Each model turn must be a single JSON object with a \"type\" field: thought | action | wait | result.",
    )};

export async function registerExampleAgent(): Promise<void> {
  await Agent.define({
    id: "example-agent",
    name: "Example agent",
    systemPrompt: SYSTEM,
    skills: ["exampleSkill"],
    tools: ["save_memory", "get_memory"],
    llm: { provider: "${llm === "openai" ? "openai" : llm === "anthropic" ? "anthropic" : "custom"}", model: "${
      llm === "openai" ? "gpt-4o" : llm === "anthropic" ? "claude-3-5-sonnet-20241022" : "custom"
    }", temperature: 0.2 },
    security: { roles: ["agent"] },
  });
}

export async function loadExampleAgent(runtime: AgentRuntime, sessionOpts: SessionOptions) {
  const session = new Session(sessionOpts);
  return Agent.load("example-agent", runtime, { session });
}
`,

    "tools/save-memory.ts": `import { Tool } from "@agent-runtime/core";

export async function registerSaveMemoryTool(): Promise<void> {
  await Tool.define({
    id: "save_memory",
    name: "Save memory",
    scope: "global",
    description: "Persists content in the agent's memory.",
    inputSchema: {
      type: "object",
      properties: {
        memoryType: { enum: ["shortTerm", "longTerm", "working"] },
        content: {},
      },
      required: ["memoryType", "content"],
    },
    outputSchema: { type: "object", properties: { success: { type: "boolean" } } },
    roles: ["admin", "agent"],
  });
}

/** Wire your handler with ToolRunner in application bootstrap. */
export async function handleSaveMemory(_input: unknown): Promise<{ success: boolean }> {
  return { success: true };
}
`,

    "skills/example-skill.ts": `import { Skill } from "@agent-runtime/core";

export async function registerExampleSkill(): Promise<void> {
  await Skill.define({
    id: "exampleSkill",
    name: "Example skill",
    scope: "global",
    tools: ["save_memory"],
    description: "Starter skill referencing memory tools.",
    roles: ["agent"],
  });
}
`,

    "src/index.ts": `import { registerExampleAgent } from "../agents/example-agent.js";
import { registerExampleSkill } from "../skills/example-skill.js";
import { registerSaveMemoryTool } from "../tools/save-memory.js";

async function bootstrap() {
  await registerSaveMemoryTool();
  await registerExampleSkill();
  await registerExampleAgent();
  console.log("Definitions registered. Run your runner or import loadExampleAgent from agents/example-agent.");
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
`,

    "tests/example-agent.test.ts": `import { describe, it, expect } from "vitest";

describe("example-agent", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
`,

    "README.md": `# ${name}

Generated by \`@agent-runtime/scaffold\`.

## Next steps

1. \`cd ${name}\` (or stay in this directory)
2. Copy \`.env.example\` to \`.env\` and add API keys
3. Install deps: \`${packageManager} install\`
4. Dev: \`${pmRun} dev\`
`,
  };
}
