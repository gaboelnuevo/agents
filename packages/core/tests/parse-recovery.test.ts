import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
  StepSchemaError,
  clearAllRegistriesForTests,
} from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

class QueueLLM implements LLMAdapter {
  constructor(private readonly queue: string[]) {}
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.queue[this.i++] ??
      JSON.stringify({ type: "result", content: "fallback" });
    return { content };
  }
}

beforeEach(() => {
  clearAllRegistriesForTests();
});

describe("parse recovery", () => {
  it("does not increment run.state.iteration when the first LLM output fails parse and the retry succeeds", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      "not valid json {",
      JSON.stringify({ type: "thought", content: "recovered" }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "parse-agent",
      projectId: "p-parse",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-parse", projectId: "p-parse" });
    const agent = await Agent.load("parse-agent", rt, { session });
    const run = await agent.run("hi");

    expect(run.status).toBe("completed");
    /** One successful thought/action turn increments iteration; `result` returns before increment. */
    expect(run.state.iteration).toBe(1);
    expect(
      run.history.some((h) => h.type === "thought" && h.content === "recovered"),
    ).toBe(true);
  });

  it("throws StepSchemaError when parse recovery is exhausted", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM(["bad-first", "bad-second"]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "parse-fail",
      projectId: "p-parse",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-fail", projectId: "p-parse" });
    const agent = await Agent.load("parse-fail", rt, { session });
    await expect(agent.run("hi")).rejects.toThrow(StepSchemaError);
  });
});
