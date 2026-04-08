import { buildRuntimeTs } from "../runtime-snippet.js";
import type { InitProjectOptions } from "../types.js";

export function minimalTemplateFiles(opts: {
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
          dev: "tsx watch agent.ts",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@agent-runtime/core": "^0.0.0",
        },
        devDependencies: {
          "@types/node": "^22",
          tsx: "^4",
          typescript: "^5.7",
        },
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
        },
        include: ["agent.ts", "config/**/*.ts"],
      },
      null,
      2,
    ),

    ".env.example": `OPENAI_API_KEY=
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=
REDIS_URL=
`,

    "config/runtime.ts": buildRuntimeTs({ adapter, llm }),

    "agent.ts": `import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import { Agent, AgentRuntime, InMemoryMemoryAdapter, Session } from "@agent-runtime/core";

const SYSTEM = "Minimal single-file agent. Respond with one JSON Step per turn.";

/** Swap for OpenAILLMAdapter etc. when you add API keys — keeps the template dependency-free. */
class StubLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({ type: "thought", content: "Plan a one-line reply." })
        : JSON.stringify({ type: "result", content: "Hello from the minimal scaffold." });
    return { content };
  }
}

async function main() {
  const runtime = new AgentRuntime({
    llmAdapter: new StubLlm(),
    memoryAdapter: new InMemoryMemoryAdapter(),
    maxIterations: 10,
  });

  await Agent.define({
    id: "minimal-agent",
    name: "Minimal agent",
    systemPrompt: SYSTEM,
    tools: [],
    llm: { provider: "${llm === "openai" ? "openai" : "anthropic"}", model: "${
      llm === "openai" ? "gpt-4o" : "claude-3-5-sonnet-20241022"
    }", temperature: 0.2 },
  });

  const session = new Session({ id: "dev", projectId: "default" });
  const agent = await Agent.load("minimal-agent", runtime, { session });
  const out = await agent.run("Hello");
  console.log(out);
}

main().catch(console.error);
`,

    "README.md": `# ${name} (minimal)

1. \`${packageManager} install\`
2. \`.env\` from \`.env.example\`
3. \`${pmRun} dev\`
`,
  };
}
