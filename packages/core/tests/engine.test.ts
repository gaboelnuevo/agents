import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  Session,
  Skill,
  Tool,
  buildEngineDeps,
  configureRuntime,
  createRun,
  effectiveToolAllowlist,
  executeRun,
  getAgentDefinition,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  clearAllRegistriesForTests,
  __resetRuntimeConfigForTests,
} from "../src/index.js";
import type { AgentDefinitionPersisted } from "../src/types.js";
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

describe("engine", () => {
  it("effectiveToolAllowlist merges skill tools", async () => {
    await Skill.define({
      id: "sk-merge",
      projectId: "p1",
      tools: ["save_memory"],
    });
    const agent: AgentDefinitionPersisted = {
      id: "a-merge",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      skills: ["sk-merge"],
      llm: { provider: "openai", model: "gpt-4o" },
    };
    const allow = effectiveToolAllowlist(agent, "p1");
    expect(allow.has("save_memory")).toBe(true);
  });

  it("exports createRun and executeRun", () => {
    expect(typeof executeRun).toBe("function");
    const run = createRun("agent-x", "sess-1", "hello");
    expect(run.agentId).toBe("agent-x");
    expect(run.status).toBe("running");
    expect(run.state.userInput).toBe("hello");
  });

  it("executeRun completes with manually built EngineDeps", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "direct" }),
      JSON.stringify({ type: "result", content: "via executeRun" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a5",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p1", "a5");
    expect(agentDef).toBeDefined();

    const session = new Session({ id: "s-direct", projectId: "p1" });
    const base = buildEngineDeps(agentDef!, session);

    const run = createRun("a5", session.id, "hi");
    const result = await executeRun(run, {
      ...base,
      startedAtMs: Date.now(),
    });

    expect(result.status).toBe("completed");
    expect(
      result.history.some((h) => h.type === "result" && h.content === "via executeRun"),
    ).toBe(true);
  });

  it("runs thought then result", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "thinking" }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a1",
      projectId: "p1",
      systemPrompt: "You are a test agent.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a1", { session });
    const run = await agent.run("hello");

    expect(run.status).toBe("completed");
    expect(run.history.some((h) => h.type === "thought")).toBe(true);
    expect(run.history.some((h) => h.type === "result")).toBe(true);
  });

  it("executes save_memory action", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "save_memory",
        input: { memoryType: "working", content: { note: "x" } },
      }),
      JSON.stringify({ type: "result", content: "saved" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem });

    await Agent.define({
      id: "a2",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["save_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a2", { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    const rows = await mem.query(
      { projectId: "p1", agentId: "a2", sessionId: "s1" },
      "working",
    );
    expect(rows.length).toBe(1);
  });

  it("persists wait and resumes with runStore", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "wait",
        reason: "Need external input",
      }),
      JSON.stringify({ type: "result", content: "resumed" }),
    ]);
    configureRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a3",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a3", { session });
    const waiting = await agent.run("start");

    expect(waiting.status).toBe("waiting");
    const stored = await store.load(waiting.runId);
    expect(stored?.status).toBe("waiting");

    const done = await agent.resume(waiting.runId, {
      type: "message",
      content: "here",
    });
    expect(done.status).toBe("completed");
    expect(
      done.history.some((h) => h.type === "result" && h.content === "resumed"),
    ).toBe(true);
  });

  it("records tool timeout as failed observation when toolTimeoutMs is set", async () => {
    await Tool.define({
      id: "slow_tool",
      scope: "global",
      description: "Sleeps longer than timeout",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { ok: true };
      },
    });

    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "slow_tool",
        input: {},
      }),
      JSON.stringify({ type: "result", content: "after timeout" }),
    ]);
    configureRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      toolTimeoutMs: 40,
    });

    await Agent.define({
      id: "a-timeout",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["slow_tool"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a-timeout", { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    const obs = run.history.find((h) => h.type === "observation");
    expect(obs?.type).toBe("observation");
    const content = obs?.content as { success?: boolean; error?: string };
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/timed out/i);
  });

  it("onWait can continue a waiting run in-process", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "need_ok" }),
      JSON.stringify({ type: "result", content: "after wait" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a4",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a4", { session });
    const run = await agent.run("go").onWait(async () => "proceed");

    expect(run.status).toBe("completed");
    expect(run.history.some((h) => h.type === "result" && h.content === "after wait")).toBe(
      true,
    );
  });
});
