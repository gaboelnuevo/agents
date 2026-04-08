/**
 * OpenAI + custom tool + skill: the skill exposes `roll_dice`. The engine maps native
 * `tool_calls` (empty `content`) into `action` steps — no extra LLM wrapper required.
 */
import { OpenAILLMAdapter } from "@agent-runtime/adapters-openai";
import {
  Agent,
  AgentRuntime,
  Session,
  Skill,
  Tool,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";

const PROJECT_ID = "demo-openai";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY in the environment. See .env.example in this folder.");
    process.exit(1);
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const runtime = new AgentRuntime({
    llmAdapter: new OpenAILLMAdapter(apiKey),
    memoryAdapter: new InMemoryMemoryAdapter(),
    maxIterations: 15,
  });

  await Tool.define({
    id: "roll_dice",
    scope: "global",
    description:
      "Roll a single fair die with `sides` faces (minimum 2). Returns { side: number }.",
    inputSchema: {
      type: "object",
      properties: {
        sides: { type: "number", description: "Number of sides (e.g. 6 for d6, 20 for d20)." },
      },
      required: ["sides"],
    },
    execute: async (input: unknown) => {
      const sides = Math.max(
        2,
        Math.floor(Number((input as { sides?: unknown }).sides ?? 6)),
      );
      return { side: 1 + Math.floor(Math.random() * sides), sides };
    },
  });

  await Skill.define({
    id: "dice-skill",
    projectId: PROJECT_ID,
    tools: ["roll_dice"],
    description: "Rolling dice for games and demos.",
  });

  await Agent.define({
    id: "demo-gamer",
    projectId: PROJECT_ID,
    systemPrompt: [
      "You are a concise assistant for dice rolls.",
      "When the user asks to roll, emit an action step that calls roll_dice with the requested number of sides (default 6).",
      "After you see the observation, emit a short result step summarizing the value.",
    ].join(" "),
    skills: ["dice-skill"],
    tools: [],
    llm: { provider: "openai", model },
  });

  const session = new Session({
    id: "session-openai-1",
    projectId: PROJECT_ID,
  });

  const agent = await Agent.load("demo-gamer", runtime, { session });
  const run = await agent.run("Roll a twenty-sided die once and tell me only the number.");

  console.log("status:", run.status);
  const result = run.history.filter((h) => h.type === "result").pop();
  if (result && typeof result.content === "string") {
    console.log("result:", result.content);
  } else {
    console.log("history:", JSON.stringify(run.history, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
