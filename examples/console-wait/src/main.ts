/**
 * Console REPL-style pause: the mock LLM returns `wait` once; `RunBuilder.onWait`
 * reads a line from stdin and feeds it back as `[resume:text]`; the second LLM
 * turn returns a `result` that echoes the input.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";

const PROJECT_ID = "demo-console-wait";

/** First turn: `wait`. Second turn: `result` using text captured after `onWait`. */
class WaitThenEchoLlm implements LLMAdapter {
  private turn = 0;

  constructor(private readonly userLine: { value: string }) {}

  async generate(_req: LLMRequest): Promise<LLMResponse> {
    if (this.turn++ === 0) {
      return {
        content: JSON.stringify({
          type: "wait",
          reason: "I need one piece of input from you (prompt below).",
        }),
      };
    }
    const line = this.userLine.value.trim() || "(empty)";
    return {
      content: JSON.stringify({
        type: "result",
        content: `Done. Received from console: «${line}».`,
      }),
    };
  }
}

async function main(): Promise<void> {
  const userLine = { value: "" };

  const runtime = new AgentRuntime({
    llmAdapter: new WaitThenEchoLlm(userLine),
    memoryAdapter: new InMemoryMemoryAdapter(),
    maxIterations: 10,
  });

  await Agent.define({
    id: "demo-cli-wait",
    projectId: PROJECT_ID,
    systemPrompt: "Protocol demo: you will wait once, then finish.",
    tools: [],
    llm: { provider: "openai", model: "gpt-4o-mini" },
  });

  const session = new Session({ id: "session-cli", projectId: PROJECT_ID });
  const agent = await Agent.load("demo-cli-wait", runtime, { session });

  const run = await agent
    .run("Start the interactive flow.")
    .onWait(async (step) => {
      const reason = step.type === "wait" ? step.reason : "";
      console.log("\n--- Agent pause ---");
      console.log(`Reason: ${reason}`);
      const rl = readline.createInterface({ input, output });
      const raw = await rl.question("Type a line and press Enter (or Ctrl+D to exit): ");
      rl.close();
      const text = raw?.trim() ?? "";
      userLine.value = text;
      return text.length > 0 ? text : " ";
    });

  console.log("\n--- Done ---");
  console.log("status:", run.status);
  const last = run.history.filter((h) => h.type === "result").pop();
  if (last && typeof last.content === "string") {
    console.log("result:", last.content);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
