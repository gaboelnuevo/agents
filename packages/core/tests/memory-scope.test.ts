import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  Session,
  configureRuntime,
  InMemoryMemoryAdapter,
  clearAllRegistriesForTests,
  __resetRuntimeConfigForTests,
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
  __resetRuntimeConfigForTests();
});

describe("InMemoryMemoryAdapter end-user scoping (Phase 9.2)", () => {
  it("shares longTerm across sessions for the same endUserId", async () => {
    const mem = new InMemoryMemoryAdapter();
    const scopeA = {
      projectId: "p-eu",
      agentId: "agent-eu",
      sessionId: "session-a",
      endUserId: "user-1",
    };
    const scopeB = {
      projectId: "p-eu",
      agentId: "agent-eu",
      sessionId: "session-b",
      endUserId: "user-1",
    };
    await mem.save(scopeA, "longTerm", { tier: "premium" });
    const rows = await mem.query(scopeB, "longTerm");
    expect(rows).toEqual([{ tier: "premium" }]);
  });

  it("does not share shortTerm across sessions", async () => {
    const mem = new InMemoryMemoryAdapter();
    const scopeA = {
      projectId: "p-eu",
      agentId: "agent-eu",
      sessionId: "session-a",
      endUserId: "user-1",
    };
    const scopeB = {
      projectId: "p-eu",
      agentId: "agent-eu",
      sessionId: "session-b",
      endUserId: "user-1",
    };
    await mem.save(scopeA, "shortTerm", { turn: 1 });
    expect(await mem.query(scopeB, "shortTerm")).toEqual([]);
    expect(await mem.query(scopeA, "shortTerm")).toEqual([{ turn: 1 }]);
  });

  it("scopes longTerm per session when endUserId is absent", async () => {
    const mem = new InMemoryMemoryAdapter();
    const s1 = { projectId: "p", agentId: "a", sessionId: "s1" };
    const s2 = { projectId: "p", agentId: "a", sessionId: "s2" };
    await mem.save(s1, "longTerm", { note: "only-s1" });
    expect(await mem.query(s2, "longTerm")).toEqual([]);
    expect(await mem.query(s1, "longTerm")).toEqual([{ note: "only-s1" }]);
  });

  it("save_memory longTerm in one session is visible from another session (same endUserId)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llmS1 = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "save_memory",
        input: { memoryType: "longTerm", content: { prefs: "dark" } },
      }),
      JSON.stringify({ type: "result", content: "saved" }),
    ]);
    const llmS2 = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "get_memory",
        input: { memoryType: "longTerm" },
      }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    configureRuntime({ llmAdapter: llmS1, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "mem-agent",
      projectId: "p-mem",
      systemPrompt: "Test.",
      tools: ["save_memory", "get_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session1 = new Session({
      id: "sess-1",
      projectId: "p-mem",
      endUserId: "eu-99",
    });
    const agent1 = await Agent.load("mem-agent", { session: session1 });
    await agent1.run("save prefs");

    clearAllRegistriesForTests();
    __resetRuntimeConfigForTests();
    configureRuntime({ llmAdapter: llmS2, memoryAdapter: mem, maxIterations: 10 });
    await Agent.define({
      id: "mem-agent",
      projectId: "p-mem",
      systemPrompt: "Test.",
      tools: ["save_memory", "get_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session2 = new Session({
      id: "sess-2",
      projectId: "p-mem",
      endUserId: "eu-99",
    });
    const agent2 = await Agent.load("mem-agent", { session: session2 });
    const run2 = await agent2.run("read prefs");

    expect(run2.status).toBe("completed");
    const obs = run2.history.find((h) => h.type === "observation");
    const content = obs?.content as { success?: boolean; data?: unknown[] };
    expect(content?.success).toBe(true);
    expect(content?.data).toEqual([{ prefs: "dark" }]);
  });
});
