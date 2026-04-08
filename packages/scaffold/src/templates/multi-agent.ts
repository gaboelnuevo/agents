import { buildRuntimeTs } from "../runtime-snippet.js";
import type { InitProjectOptions } from "../types.js";
import { defaultTemplateFiles } from "./default.js";

const coordinator = `import { Agent, Session, type SessionOptions } from "@agent-runtime/core";

const SYSTEM = "You coordinate work across agents. Emit JSON Step objects only.";

export async function registerCoordinatorAgent(): Promise<void> {
  await Agent.define({
    id: "coordinator",
    name: "Coordinator",
    systemPrompt: SYSTEM,
    skills: ["exampleSkill"],
    tools: ["save_memory", "get_memory"],
    llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
    security: { roles: ["agent"] },
  });
}

export async function loadCoordinator(sessionOpts: SessionOptions) {
  const session = new Session(sessionOpts);
  return Agent.load("coordinator", { session });
}
`;

const worker = `import { Agent, Session, type SessionOptions } from "@agent-runtime/core";

const SYSTEM = "You execute delegated tasks. Emit JSON Step objects only.";

export async function registerWorkerAgent(): Promise<void> {
  await Agent.define({
    id: "worker",
    name: "Worker",
    systemPrompt: SYSTEM,
    tools: ["save_memory", "get_memory"],
    llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
    security: { roles: ["agent"] },
  });
}

export async function loadWorker(sessionOpts: SessionOptions) {
  const session = new Session(sessionOpts);
  return Agent.load("worker", { session });
}
`;

const messageBus = `import type { AgentMessage, MessageBus } from "@agent-runtime/core";

/** Stub — replace with Redis / in-process queue (see docs/core/09-communication-multiagent.md). */
export function createInProcessMessageBus(): MessageBus {
  return {
    async send(_msg: Omit<AgentMessage, "id">) {
      throw new Error("MessageBus.send not wired — implement for your deployment.");
    },
    waitFor(_agentId, _filter, _options) {
      throw new Error("MessageBus.waitFor not wired — implement for your deployment.");
    },
  };
}
`;

export function multiAgentTemplateFiles(opts: {
  name: string;
  adapter: NonNullable<InitProjectOptions["adapter"]>;
  llm: NonNullable<InitProjectOptions["llm"]>;
  packageManager: NonNullable<InitProjectOptions["packageManager"]>;
}): Record<string, string> {
  const base = defaultTemplateFiles(opts);
  const { ["agents/example-agent.ts"]: _omit, ...rest } = base;

  return {
    ...rest,
    "agents/coordinator.ts": coordinator,
    "agents/worker.ts": worker,
    "config/message-bus.ts": messageBus,
    "config/runtime.ts": buildRuntimeTs({
      adapter: opts.adapter,
      llm: opts.llm,
    }),
    "src/index.ts": `import { registerCoordinatorAgent } from "../agents/coordinator.js";
import { registerWorkerAgent } from "../agents/worker.js";
import { registerExampleSkill } from "../skills/example-skill.js";
import { registerSaveMemoryTool } from "../tools/save-memory.js";

async function bootstrap() {
  await registerSaveMemoryTool();
  await registerExampleSkill();
  await registerCoordinatorAgent();
  await registerWorkerAgent();
  console.log("Multi-agent definitions registered.");
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
`,
    "README.md": `# ${opts.name} (multi-agent)

Includes \`agents/coordinator.ts\`, \`agents/worker.ts\`, and \`config/message-bus.ts\`.

See **09-communication-multiagent** in \`@agent-runtime\` docs for production MessageBus wiring.
`,
  };
}
