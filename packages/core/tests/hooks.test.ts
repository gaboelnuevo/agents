import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  buildEngineDeps,
  createRun,
  executeRun,
  getAgentDefinition,
  InMemoryMemoryAdapter,
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

describe("EngineHooks ordering", () => {
  it("fires onLLMResponse before onThought, then onAction and onObservation for an action step", async () => {
    const events: string[] = [];
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t1" }),
      JSON.stringify({
        type: "action",
        tool: "save_memory",
        input: { memoryType: "working", content: { n: 1 } },
      }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "hook-agent",
      projectId: "p-hooks",
      systemPrompt: "Test.",
      tools: ["save_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p-hooks", "hook-agent");
    expect(agentDef).toBeDefined();
    const session = new Session({ id: "s-hooks", projectId: "p-hooks" });

    const base = buildEngineDeps(agentDef!, session, rt, {
      hooks: {
        onLLMResponse: () => {
          events.push("onLLMResponse");
        },
        onLLMAfterParse: () => {
          events.push("onLLMAfterParse");
        },
        onThought: () => {
          events.push("onThought");
        },
        onAction: () => {
          events.push("onAction");
        },
        onObservation: () => {
          events.push("onObservation");
        },
      },
    });

    const run = createRun("hook-agent", session.id, "hi");
    const result = await executeRun(run, {
      ...base,
      startedAtMs: Date.now(),
    });

    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "onLLMResponse",
      "onLLMAfterParse",
      "onThought",
      "onLLMResponse",
      "onLLMAfterParse",
      "onAction",
      "onObservation",
      "onLLMResponse",
      "onLLMAfterParse",
    ]);
  });

  it("fires onWait when the model returns a wait step", async () => {
    const events: string[] = [];
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "need_input" }),
    ]);
    const rt = new AgentRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "hook-wait",
      projectId: "p-hooks",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p-hooks", "hook-wait");
    const session = new Session({ id: "s-w", projectId: "p-hooks" });
    const base = buildEngineDeps(agentDef!, session, rt, {
      hooks: {
        onLLMResponse: () => events.push("onLLMResponse"),
        onLLMAfterParse: () => events.push("onLLMAfterParse"),
        onWait: () => events.push("onWait"),
      },
    });

    const run = createRun("hook-wait", session.id, "hi");
    const result = await executeRun(run, { ...base, startedAtMs: Date.now() });

    expect(result.status).toBe("waiting");
    expect(events).toEqual(["onLLMResponse", "onLLMAfterParse", "onWait"]);
  });
});
