import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  Session,
  configureRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  clearAllRegistriesForTests,
  __resetRuntimeConfigForTests,
} from "@agent-runtime/core";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
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
  __resetRuntimeConfigForTests();
});

describe("dispatchEngineJob", () => {
  it("runs Agent.run for kind run", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t" }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "a1",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const run = await dispatchEngineJob({
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
    configureRuntime({
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

    const waiting = await dispatchEngineJob({
      kind: "run",
      projectId: "p1",
      agentId: "a2",
      sessionId: "s2",
      userInput: "start",
    });
    expect(waiting.status).toBe("waiting");

    const done = await dispatchEngineJob({
      kind: "resume",
      projectId: "p1",
      agentId: "a2",
      sessionId: "s2",
      runId: waiting.runId,
      resumeInput: { type: "message", content: "ok" },
    });
    expect(done.status).toBe("completed");
  });
});
