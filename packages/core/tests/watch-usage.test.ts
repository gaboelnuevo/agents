import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  Session,
  configureRuntime,
  InMemoryMemoryAdapter,
  watchUsage,
  StepSchemaError,
  clearAllRegistriesForTests,
  __resetRuntimeConfigForTests,
} from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

type UsageChunk = {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

class UsageQueueLLM implements LLMAdapter {
  constructor(private readonly queue: UsageChunk[]) {}
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const item =
      this.queue[this.i++] ?? {
        content: JSON.stringify({ type: "result", content: "fallback" }),
        usage: { totalTokens: 0 },
      };
    return { content: item.content, usage: item.usage };
  }
}

beforeEach(() => {
  clearAllRegistriesForTests();
  __resetRuntimeConfigForTests();
});

describe("watchUsage (Phase 9.3)", () => {
  it("accumulates token fields, llmCalls, and zero wasted tokens when every parse succeeds", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new UsageQueueLLM([
      {
        content: JSON.stringify({ type: "thought", content: "t" }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      {
        content: JSON.stringify({ type: "result", content: "done" }),
        usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      },
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "usage-agent",
      projectId: "p-usage",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-u", projectId: "p-usage" });
    const agent = await Agent.load("usage-agent", { session });
    const runBuilder = agent.run("hello");
    const { builder, getUsage } = watchUsage(runBuilder, {
      projectId: "p-usage",
      organizationId: "org-9",
    });

    const run = await builder;
    expect(run.status).toBe("completed");

    const snap = getUsage();
    expect(snap.projectId).toBe("p-usage");
    expect(snap.organizationId).toBe("org-9");
    expect(snap.agentId).toBe("usage-agent");
    expect(snap.runId).toBe(run.runId);
    expect(snap.llmCalls).toBe(2);
    expect(snap.promptTokens).toBe(12);
    expect(snap.completionTokens).toBe(6);
    expect(snap.totalTokens).toBe(18);
    expect(snap.wastedPromptTokens).toBe(0);
    expect(snap.wastedCompletionTokens).toBe(0);
    expect(snap.wastedTotalTokens).toBe(0);
  });

  it("counts wasted tokens for LLM outputs that fail parse (recoverable then success)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new UsageQueueLLM([
      {
        content: "not-json",
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      },
      {
        content: JSON.stringify({ type: "thought", content: "ok" }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      {
        content: JSON.stringify({ type: "result", content: "done" }),
        usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      },
    ]);
    configureRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "usage-waste",
      projectId: "p-usage",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-w", projectId: "p-usage" });
    const agent = await Agent.load("usage-waste", { session });
    const { builder, getUsage } = watchUsage(agent.run("hi"), {
      projectId: "p-usage",
      organizationId: "org-9",
    });

    const run = await builder;
    expect(run.status).toBe("completed");

    const snap = getUsage();
    expect(snap.llmCalls).toBe(3);
    expect(snap.promptTokens).toBe(112);
    expect(snap.totalTokens).toBe(158);
    expect(snap.wastedPromptTokens).toBe(100);
    expect(snap.wastedCompletionTokens).toBe(40);
    expect(snap.wastedTotalTokens).toBe(140);
  });

  it("counts wasted tokens for recoverable and fatal failed parses (run throws)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new UsageQueueLLM([
      {
        content: "bad-1",
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      },
      {
        content: "bad-2",
        usage: { promptTokens: 30, completionTokens: 8, totalTokens: 38 },
      },
    ]);
    configureRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "usage-fatal",
      projectId: "p-usage",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-f", projectId: "p-usage" });
    const agent = await Agent.load("usage-fatal", { session });
    const { builder, getUsage } = watchUsage(agent.run("hi"), {
      projectId: "p-usage",
      organizationId: "org-9",
    });

    await expect(builder).rejects.toThrow(StepSchemaError);

    const snap = getUsage();
    expect(snap.llmCalls).toBe(2);
    expect(snap.promptTokens).toBe(80);
    expect(snap.completionTokens).toBe(18);
    expect(snap.totalTokens).toBe(98);
    expect(snap.wastedPromptTokens).toBe(80);
    expect(snap.wastedCompletionTokens).toBe(18);
    expect(snap.wastedTotalTokens).toBe(98);
  });
});
