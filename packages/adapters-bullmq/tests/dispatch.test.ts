import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  EngineJobExpiredError,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  clearAllRegistriesForTests,
} from "@agent-runtime/core";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import Redis from "ioredis-mock";
import { RedisMemoryAdapter } from "@agent-runtime/adapters-redis";
import { dispatchEngineJob } from "../src/dispatch.js";

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

describe("dispatchEngineJob", () => {
  it("runs Agent.run for kind run", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t" }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a1",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const run = await dispatchEngineJob(rt, {
      kind: "run",
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
      userInput: "hello",
    });

    expect(run.status).toBe("completed");
  });

  it("runs Agent.resume for kind resume", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "x" }),
      JSON.stringify({ type: "result", content: "after" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a2",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const waiting = await dispatchEngineJob(rt, {
      kind: "run",
      projectId: "p1",
      agentId: "a2",
      sessionId: "s2",
      userInput: "start",
    });
    expect(waiting.status).toBe("waiting");

    const done = await dispatchEngineJob(rt, {
      kind: "resume",
      projectId: "p1",
      agentId: "a2",
      sessionId: "s2",
      runId: waiting.runId,
      resumeInput: { type: "message", content: "ok" },
    });
    expect(done.status).toBe("completed");
  });

  it("forwards optional endUserId for B2B2C memory keys (Redis adapter)", async () => {
    const redis = new Redis();
    const mem = new RedisMemoryAdapter(redis);
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "save_memory",
        input: { memoryType: "longTerm", content: { note: "eu-scoped" } },
      }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a3",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["save_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    await dispatchEngineJob(rt, {
      kind: "run",
      projectId: "p1",
      agentId: "a3",
      sessionId: "sess-b2b",
      endUserId: "customer-99",
      userInput: "hello",
    });

    const keys = await redis.keys("m:p1:a3:sess-b2b:*");
    expect(keys.some((k) => k.includes("eu:customer-99"))).toBe(true);
  });

  it("throws EngineJobExpiredError when expiresAtMs is in the past", async () => {
    const rt = new AgentRuntime({
      llmAdapter: new QueueLLM([JSON.stringify({ type: "result", content: "x" })]),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a-exp",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    await expect(
      dispatchEngineJob(rt, {
        kind: "run",
        projectId: "p1",
        agentId: "a-exp",
        sessionId: "s1",
        userInput: "hi",
        expiresAtMs: Date.now() - 60_000,
      }),
    ).rejects.toThrow(EngineJobExpiredError);
  });
});
