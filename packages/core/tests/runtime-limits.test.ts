import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  Session,
  buildEngineDeps,
  configureRuntime,
  createRun,
  executeRun,
  getAgentDefinition,
  InMemoryMemoryAdapter,
  RunCancelledError,
  RunTimeoutError,
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

describe("runtime limits (Phase 9.6)", () => {
  it("throws RunTimeoutError when elapsed time exceeds runTimeoutMs", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "never reached" }),
    ]);
    configureRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
      runTimeoutMs: 500,
    });

    await Agent.define({
      id: "t-out",
      projectId: "p-rl",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p-rl", "t-out");
    expect(agentDef).toBeDefined();
    const session = new Session({ id: "s-rl", projectId: "p-rl" });
    const base = buildEngineDeps(agentDef!, session);
    const run = createRun("t-out", session.id, "hi");

    await expect(
      executeRun(run, {
        ...base,
        startedAtMs: Date.now() - 60_000,
      }),
    ).rejects.toThrow(RunTimeoutError);

    expect(run.status).toBe("failed");
  });

  it("throws RunCancelledError when AbortSignal is already aborted", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "never" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "t-abort",
      projectId: "p-rl",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p-rl", "t-abort");
    const session = new Session({ id: "s-ab", projectId: "p-rl" });
    const ac = new AbortController();
    ac.abort();
    const base = buildEngineDeps(agentDef!, session, { signal: ac.signal });
    const run = createRun("t-abort", session.id, "hi");

    await expect(
      executeRun(run, {
        ...base,
        startedAtMs: Date.now(),
      }),
    ).rejects.toThrow(RunCancelledError);

    expect(run.status).toBe("failed");
  });
});
