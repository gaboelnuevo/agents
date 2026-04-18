import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  Skill,
  StepSchemaError,
  Tool,
  buildEngineDeps,
  createRun,
  effectiveToolAllowlist,
  executeRun,
  getAgentDefinition,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  clearAllRegistriesForTests,
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
});

describe("engine", () => {
  it("effectiveToolAllowlist merges skill tools", async () => {
    await Skill.define({
      id: "sk-merge",
      projectId: "p1",
      tools: ["system_save_memory"],
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
    expect(allow.has("system_save_memory")).toBe(true);
  });

  it("buildEngineDeps merges defaultSkillIdsGlobal so agents need not list those skills", async () => {
    await Tool.define({
      id: "t-from-default-skill",
      projectId: "p1",
      description: "noop",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    });
    await Skill.define({
      id: "sk-runtime-default",
      projectId: "p1",
      description: "default skill",
      tools: ["t-from-default-skill"],
    });
    await Agent.define({
      id: "a-def-skills",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "t-from-default-skill",
        input: {},
      }),
      JSON.stringify({ type: "result", content: "ran tool from default skill" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      defaultSkillIdsGlobal: ["sk-runtime-default"],
    });

    const agentDef = getAgentDefinition("p1", "a-def-skills");
    const session = new Session({ id: "s-def-sk", projectId: "p1" });
    const base = buildEngineDeps(agentDef!, session, rt);

    expect(agentDef!.skills).toBeUndefined();
    expect(base.agent.skills).toEqual(["sk-runtime-default"]);

    const run = createRun("a-def-skills", session.id, "go", "p1");
    const result = await executeRun(run, { ...base, startedAtMs: Date.now() });
    expect(result.status).toBe("completed");
    expect(
      result.history.some(
        (h) => h.type === "result" && h.content === "ran tool from default skill",
      ),
    ).toBe(true);
  });

  it("buildEngineDeps merges defaultSkillIdsGlobal for every project", async () => {
    await Tool.define({
      id: "t-global-skill",
      description: "g",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    });
    await Skill.define({
      id: "sk-global-default",
      description: "global",
      tools: ["t-global-skill"],
    });
    await Agent.define({
      id: "a-other-project",
      projectId: "p-xyz",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "t-global-skill",
        input: {},
      }),
      JSON.stringify({ type: "result", content: "global default skill" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      defaultSkillIdsGlobal: ["sk-global-default"],
    });

    const agentDef = getAgentDefinition("p-xyz", "a-other-project");
    const session = new Session({ id: "s-glob", projectId: "p-xyz" });
    const base = buildEngineDeps(agentDef!, session, rt);
    expect(base.agent.skills).toEqual(["sk-global-default"]);

    const run = createRun("a-other-project", session.id, "go", "p-xyz");
    const result = await executeRun(run, { ...base, startedAtMs: Date.now() });
    expect(result.status).toBe("completed");
    expect(
      result.history.some(
        (h) => h.type === "result" && h.content === "global default skill",
      ),
    ).toBe(true);
  });

  it("buildEngineDeps merges global defaults then agent skills (dedupe)", async () => {
    await Skill.define({
      id: "sk-g",
      projectId: "p-order",
      description: "g",
      tools: [],
    });
    await Skill.define({
      id: "sk-x",
      projectId: "p-order",
      description: "x",
      tools: [],
    });
    await Skill.define({
      id: "sk-a",
      projectId: "p-order",
      description: "a",
      tools: [],
    });
    await Agent.define({
      id: "a-order",
      projectId: "p-order",
      systemPrompt: "Test.",
      tools: [],
      skills: ["sk-a", "sk-g"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([JSON.stringify({ type: "result", content: "ok" })]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      defaultSkillIdsGlobal: ["sk-g", "sk-x"],
    });
    const agentDef = getAgentDefinition("p-order", "a-order");
    const session = new Session({ id: "s-order", projectId: "p-order" });
    const base = buildEngineDeps(agentDef!, session, rt);
    expect(base.agent.skills).toEqual(["sk-g", "sk-x", "sk-a"]);
  });

  it("exports createRun and executeRun", () => {
    expect(typeof executeRun).toBe("function");
    const run = createRun("agent-x", "sess-1", "hello");
    expect(run.agentId).toBe("agent-x");
    expect(run.status).toBe("running");
    expect(run.state.userInput).toBe("hello");
    expect(run.projectId).toBeUndefined();
  });

  it("createRun sets projectId when provided", () => {
    const run = createRun("a", "s", "u", "p-tenant");
    expect(run.projectId).toBe("p-tenant");
  });

  it("createRun uses explicitRunId when provided", () => {
    const run = createRun("a", "s", "u", "p-tenant", "planner-correlated-run-id");
    expect(run.runId).toBe("planner-correlated-run-id");
  });

  it("buildEngineDeps uses runtime fileReadRoot when session omits it", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([JSON.stringify({ type: "result", content: "ok" })]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      fileReadRoot: "/data/runtime-root",
    });
    await Agent.define({
      id: "a-fr",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });
    const agentDef = getAgentDefinition("p1", "a-fr");
    const session = new Session({ id: "s-fr", projectId: "p1" });
    const base = buildEngineDeps(agentDef!, session, rt);
    expect(base.fileReadRoot).toBe("/data/runtime-root");
  });

  it("buildEngineDeps prefers session fileReadRoot over runtime", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([JSON.stringify({ type: "result", content: "ok" })]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      fileReadRoot: "/runtime",
    });
    await Agent.define({
      id: "a-fr2",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });
    const agentDef = getAgentDefinition("p1", "a-fr2");
    const session = new Session({
      id: "s-fr2",
      projectId: "p1",
      fileReadRoot: "/session",
    });
    const base = buildEngineDeps(agentDef!, session, rt);
    expect(base.fileReadRoot).toBe("/session");
  });

  it("executeRun completes with manually built EngineDeps", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "direct" }),
      JSON.stringify({ type: "result", content: "via executeRun" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

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
    const base = buildEngineDeps(agentDef!, session, rt);

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
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a1",
      projectId: "p1",
      systemPrompt: "You are a test agent.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a1", rt, { session });
    const run = await agent.run("hello");

    expect(run.status).toBe("completed");
    expect(run.history.some((h) => h.type === "thought")).toBe(true);
    expect(run.history.some((h) => h.type === "result")).toBe(true);
  });

  it("executes system_save_memory action", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "system_save_memory",
        input: { memoryType: "working", content: { note: "x" } },
      }),
      JSON.stringify({ type: "result", content: "saved" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem });

    await Agent.define({
      id: "a2",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["system_save_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a2", rt, { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    const rows = await mem.query(
      { projectId: "p1", agentId: "a2", sessionId: "s1" },
      "working",
    );
    expect(rows.length).toBe(1);
  });

  it("maps native toolCalls to action when content is empty", async () => {
    class ToolCallsThenResult implements LLMAdapter {
      private i = 0;
      async generate(): Promise<LLMResponse> {
        if (this.i++ === 0) {
          return {
            content: "",
            toolCalls: [{ name: "echo_tool", arguments: JSON.stringify({ msg: "hi" }) }],
          };
        }
        return { content: JSON.stringify({ type: "result", content: "done" }) };
      }
    }

    const rt = new AgentRuntime({
      llmAdapter: new ToolCallsThenResult(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });

    await Tool.define({
      id: "echo_tool",
      scope: "global",
      description: "Echo",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
      execute: async (input) => ({ echoed: (input as { msg: string }).msg }),
    });

    await Agent.define({
      id: "a-toolcalls",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["echo_tool"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-tc", projectId: "p1" });
    const agent = await Agent.load("a-toolcalls", rt, { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    expect(run.history.some((h) => h.type === "action")).toBe(true);
    const obs = run.history.find((h) => h.type === "observation");
    expect(obs?.content).toEqual({ echoed: "hi" });
  });

  it("forwards Session.sessionContext into tool execute context", async () => {
    class OneToolCall implements LLMAdapter {
      private i = 0;
      async generate(): Promise<LLMResponse> {
        if (this.i++ === 0) {
          return {
            content: "",
            toolCalls: [{ name: "ctx_echo", arguments: JSON.stringify({}) }],
          };
        }
        return { content: JSON.stringify({ type: "result", content: "done" }) };
      }
    }

    const rt = new AgentRuntime({
      llmAdapter: new OneToolCall(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });

    await Tool.define({
      id: "ctx_echo",
      scope: "global",
      description: "Echo sessionContext",
      inputSchema: { type: "object", properties: {} },
      execute: async (_input, ctx) => ({
        locale: ctx.sessionContext?.locale,
        tier: ctx.sessionContext?.tier,
      }),
    });

    await Agent.define({
      id: "a-ctx",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: ["ctx_echo"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({
      id: "s-ctx",
      projectId: "p1",
      sessionContext: { locale: "es", tier: "pro" },
    });
    const agent = await Agent.load("a-ctx", rt, { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    const obs = run.history.find((h) => h.type === "observation");
    expect(obs?.content).toEqual({ locale: "es", tier: "pro" });
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
    const rt = new AgentRuntime({
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
    const agent = await Agent.load("a3", rt, { session });
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
    expect(done.state.resumeInputs).toEqual(["here"]);
  });

  it("continueRun appends a user turn after completed (same runId)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "first answer" }),
      JSON.stringify({ type: "result", content: "second answer" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a-continue",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-continue", projectId: "p1" });
    const agent = await Agent.load("a-continue", rt, { session });
    const first = await agent.run("hello");
    expect(first.status).toBe("completed");
    expect(
      first.history.some((h) => h.type === "result" && h.content === "first answer"),
    ).toBe(true);

    const second = await agent.continueRun(first.runId, "follow up");
    expect(second.status).toBe("completed");
    expect(second.state.continueInputs).toEqual(["follow up"]);
    expect(
      second.history.some((h) => h.type === "result" && h.content === "second answer"),
    ).toBe(true);
  });

  it("continueRun keeps follow-up user text when the model uses thought before result", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "first answer" }),
      JSON.stringify({ type: "thought", content: "processing follow up" }),
      JSON.stringify({ type: "result", content: "second answer" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a-continue-multistep",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-continue-ms", projectId: "p1" });
    const agent = await Agent.load("a-continue-multistep", rt, { session });
    const first = await agent.run("hello");
    expect(first.status).toBe("completed");

    const second = await agent.continueRun(first.runId, "follow up");
    expect(second.status).toBe("completed");
    const results = second.history.filter((h) => h.type === "result");
    expect(results.map((h) => h.content)).toContain("second answer");
    expect(results.pop()?.content).toBe("second answer");
  });

  it("continueRun: exhausted parse recovery persists failed (not stuck running in runStore)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "first answer" }),
      "not-json-one",
      "not-json-two",
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "a-continue-parse-fail",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-continue-parse-fail", projectId: "p1" });
    const agent = await Agent.load("a-continue-parse-fail", rt, { session });
    const first = await agent.run("hello");
    expect(first.status).toBe("completed");

    await expect(agent.continueRun(first.runId, "follow up")).rejects.toThrow(StepSchemaError);
    const stored = await store.load(first.runId);
    expect(stored?.status).toBe("failed");
    expect(String(stored?.state.failedReason ?? "")).toContain("Exceeded parse recovery");
  });

  it("continueRun after failed keeps same runId and history for the next turn", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "first answer" }),
      "not-json-one",
      "not-json-two",
      JSON.stringify({ type: "result", content: "after fail" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "a-continue-after-fail",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-continue-after-fail", projectId: "p1" });
    const agent = await Agent.load("a-continue-after-fail", rt, { session });
    const first = await agent.run("hello");
    expect(first.status).toBe("completed");

    await expect(agent.continueRun(first.runId, "follow up")).rejects.toThrow(StepSchemaError);

    const third = await agent.continueRun(first.runId, "try again");
    expect(third.runId).toBe(first.runId);
    expect(third.status).toBe("completed");
    expect(
      third.history.some((h) => h.type === "result" && h.content === "first answer"),
    ).toBe(true);
    expect(
      third.history.some((h) => h.type === "result" && h.content === "after fail"),
    ).toBe(true);
    expect(third.state.continueInputs).toEqual(["follow up", "try again"]);
  });

  it("resume: exhausted parse recovery persists failed (not stuck waiting in runStore)", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "need" }),
      "not-json-one",
      "not-json-two",
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
      maxParseRecovery: 1,
    });

    await Agent.define({
      id: "a-resume-parse-fail",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s-resume-parse-fail", projectId: "p1" });
    const agent = await Agent.load("a-resume-parse-fail", rt, { session });
    const waiting = await agent.run("start");
    expect(waiting.status).toBe("waiting");

    await expect(
      agent.resume(waiting.runId, { type: "text", content: "go" }),
    ).rejects.toThrow(StepSchemaError);
    const stored = await store.load(waiting.runId);
    expect(stored?.status).toBe("failed");
    expect(String(stored?.state.failedReason ?? "")).toContain("Exceeded parse recovery");
  });

  it("resume rejects when sessionId does not match stored run", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([JSON.stringify({ type: "wait", reason: "x" })]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a-sess",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session1 = new Session({ id: "s-correct", projectId: "p1" });
    const agent1 = await Agent.load("a-sess", rt, { session: session1 });
    const waiting = await agent1.run("start");
    expect(waiting.status).toBe("waiting");

    const session2 = new Session({ id: "s-wrong", projectId: "p1" });
    const agent2 = await Agent.load("a-sess", rt, { session: session2 });
    await expect(
      agent2.resume(waiting.runId, { type: "text", content: "nope" }),
    ).rejects.toThrow(/different session/);
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
    const rt = new AgentRuntime({
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
    const agent = await Agent.load("a-timeout", rt, { session });
    const run = await agent.run("go");

    expect(run.status).toBe("completed");
    const obs = run.history.find((h) => h.type === "observation");
    expect(obs?.type).toBe("observation");
    const content = obs?.content as { success?: boolean; error?: string; code?: string };
    expect(content.success).toBe(false);
    expect(content.code).toBe("TOOL_TIMEOUT");
    expect(content.error).toMatch(/timed out/i);
  });

  it("onWait can continue a waiting run in-process", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "need_ok" }),
      JSON.stringify({ type: "result", content: "after wait" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a4",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const session = new Session({ id: "s1", projectId: "p1" });
    const agent = await Agent.load("a4", rt, { session });
    const run = await agent.run("go").onWait(async () => "proceed");

    expect(run.status).toBe("completed");
    expect(run.history.some((h) => h.type === "result" && h.content === "after wait")).toBe(
      true,
    );
  });

  it("resume rejects run from a different projectId", async () => {
    const store = new InMemoryRunStore();
    const mem = new InMemoryMemoryAdapter();
    await store.save({
      runId: "cross-proj",
      agentId: "a-proj",
      sessionId: "s1",
      projectId: "p-alpha",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "x" },
    });
    const rt = new AgentRuntime({
      llmAdapter: new QueueLLM([JSON.stringify({ type: "result", content: "x" })]),
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });
    await Agent.define({
      id: "a-proj",
      projectId: "p-alpha",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });
    await Agent.define({
      id: "a-proj",
      projectId: "p-beta",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });
    const session = new Session({ id: "s1", projectId: "p-beta" });
    const agent = await Agent.load("a-proj", rt, { session });
    await expect(
      agent.resume("cross-proj", { type: "text", content: "go" }),
    ).rejects.toMatchObject({ code: "RUN_INVALID_STATE" });
  });

  it("resume stamps projectId from session when stored run omits it", async () => {
    const store = new InMemoryRunStore();
    const mem = new InMemoryMemoryAdapter();
    await store.save({
      runId: "legacy-proj",
      agentId: "a-leg",
      sessionId: "s1",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "x" },
    });
    const rt = new AgentRuntime({
      llmAdapter: new QueueLLM([JSON.stringify({ type: "result", content: "done" })]),
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });
    await Agent.define({
      id: "a-leg",
      projectId: "p-stamp",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });
    const session = new Session({ id: "s1", projectId: "p-stamp" });
    const agent = await Agent.load("a-leg", rt, { session });
    await agent.resume("legacy-proj", { type: "text", content: "go" });
    const after = await store.load("legacy-proj");
    expect(after?.projectId).toBe("p-stamp");
  });
});
