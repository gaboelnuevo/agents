import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  SessionExpiredError,
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

describe("session expiry", () => {
  it("rejects agent.run when session is already expired", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "never" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a-exp",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({
      id: "s-exp",
      projectId: "p1",
      expiresAtMs: Date.now() - 1,
    });
    const agent = await Agent.load("a-exp", rt, { session });

    await expect(agent.run("hello")).rejects.toThrow(SessionExpiredError);
  });

  it("rejects agent.resume when session is expired", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "wait",
        reason: "Need external input",
      }),
      JSON.stringify({ type: "result", content: "resumed" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a-res-exp",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-res", projectId: "p1" });
    const agent = await Agent.load("a-res-exp", rt, { session });
    const waiting = await agent.run("start");
    expect(waiting.status).toBe("waiting");

    const agentExpired = await Agent.load("a-res-exp", rt, {
      session: new Session({
        id: "s-res",
        projectId: "p1",
        expiresAtMs: Date.now() - 1,
      }),
    });

    await expect(
      agentExpired.resume(waiting.runId, { type: "text", content: "late" }),
    ).rejects.toThrow(SessionExpiredError);
  });

  it("Session.isExpired matches expiresAtMs", () => {
    const past = new Session({
      id: "s1",
      projectId: "p",
      expiresAtMs: 100,
    });
    expect(past.isExpired(101)).toBe(true);
    expect(past.isExpired(100)).toBe(false);

    const open = new Session({ id: "s2", projectId: "p" });
    expect(open.isExpired()).toBe(false);
  });

  it("allows run when expiresAtMs is in the future", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t" }),
      JSON.stringify({ type: "result", content: "ok" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a-fut",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({
      id: "s-fut",
      projectId: "p1",
      expiresAtMs: Date.now() + 60_000,
    });
    const agent = await Agent.load("a-fut", rt, { session });
    const run = await agent.run("hi");
    expect(run.status).toBe("completed");
  });
});
