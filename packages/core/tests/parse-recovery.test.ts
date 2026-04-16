import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
  StepSchemaError,
  Tool,
  clearAllRegistriesForTests,
} from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

/** Full responses (content + optional toolCalls) — simulates Anthropic prose + native tool_use. */
class QueueHybridLlm implements LLMAdapter {
  constructor(private readonly queue: LLMResponse[]) {}
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    return (
      this.queue[this.i++] ?? {
        content: JSON.stringify({ type: "result", content: "fallback" }),
      }
    );
  }
}

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
  it("hybrid prose + native toolCalls completes without exhausting parse recovery (planner-style)", async () => {
    await Tool.define({
      id: "t-hybrid-native",
      projectId: "p-hybrid",
      description: "noop for hybrid LLM test",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ stepped: true }),
    });
    await Agent.define({
      id: "a-hybrid",
      projectId: "p-hybrid",
      systemPrompt: "Orchestrator test.",
      tools: ["t-hybrid-native"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueHybridLlm([
      {
        content: "I'll call the helper first.\n",
        toolCalls: [{ name: "t-hybrid-native", arguments: "{}" }],
        finishReason: "tool_calls",
      },
      { content: JSON.stringify({ type: "result", content: "finished after tool" }) },
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      maxParseRecovery: 0,
    });

    const session = new Session({ id: "s-hybrid", projectId: "p-hybrid" });
    const agent = await Agent.load("a-hybrid", rt, { session });
    const run = await agent.run("plan something");

    expect(run.status).toBe("completed");
    expect(run.state.parseAttempts ?? 0).toBe(0);
    expect(
      run.history.some(
        (h) => h.type === "observation" && (h.content as { stepped?: boolean }).stepped === true,
      ),
    ).toBe(true);
    expect(
      run.history.some(
        (h) => h.type === "result" && h.content === "finished after tool",
      ),
    ).toBe(true);
  });

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
