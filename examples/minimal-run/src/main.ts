/**
 * Minimal @agent-runtime/core example: deterministic mock LLM (no API keys),
 * InMemoryMemoryAdapter, one agent and one run().
 */
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";

/** Returns fixed protocol steps so the loop completes without a real model. */
class DeterministicDemoLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({
            type: "thought",
            content: "Plan a one-line greeting for the demo.",
          })
        : JSON.stringify({
            type: "result",
            content: "Hello from the minimal agent-runtime example.",
          });
    return { content };
  }
}

async function main(): Promise<void> {
  const runtime = new AgentRuntime({
    llmAdapter: new DeterministicDemoLlm(),
    memoryAdapter: new InMemoryMemoryAdapter(),
    maxIterations: 10,
  });

  await Agent.define({
    id: "demo-greeter",
    projectId: "demo-project",
    systemPrompt: "You are a helpful assistant.",
    tools: [],
    llm: { provider: "openai", model: "gpt-4o-mini" },
  });

  const session = new Session({
    id: "demo-session-1",
    projectId: "demo-project",
  });

  const agent = await Agent.load("demo-greeter", runtime, { session });
  const run = await agent.run("Say hello.");

  console.log("status:", run.status);
  const result = run.history.find((h) => h.type === "result");
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
