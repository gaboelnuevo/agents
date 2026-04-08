import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
  InProcessMessageBus,
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

describe("multi-agent (InProcessMessageBus + send_message)", () => {
  it("delivers an event from agent A to a waiter on agent B", async () => {
    const bus = new InProcessMessageBus();
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "send_message",
        input: {
          toAgentId: "agent-b",
          type: "event",
          payload: { note: "hello-bus" },
        },
      }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      messageBus: bus,
      maxIterations: 10,
    });

    await Agent.define({
      id: "agent-a",
      projectId: "p-ma",
      systemPrompt: "Sender.",
      tools: ["send_message"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const incoming = bus.waitFor("agent-b", { fromAgentId: "agent-a" });
    const session = new Session({ id: "s-ma", projectId: "p-ma" });
    const agentA = await Agent.load("agent-a", rt, { session });
    const run = await agentA.run("ping");

    const msg = await incoming;
    expect(run.status).toBe("completed");
    expect(msg.fromAgentId).toBe("agent-a");
    expect(msg.toAgentId).toBe("agent-b");
    expect(msg.type).toBe("event");
    expect(msg.payload).toEqual({ note: "hello-bus" });
  });

  it("preserves correlationId for request messages", async () => {
    const bus = new InProcessMessageBus();
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({
        type: "action",
        tool: "send_message",
        input: {
          toAgentId: "agent-b",
          type: "request",
          correlationId: "corr-req-1",
          payload: { ask: "status" },
        },
      }),
      JSON.stringify({ type: "result", content: "ok" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      messageBus: bus,
      maxIterations: 10,
    });

    await Agent.define({
      id: "agent-a",
      projectId: "p-ma",
      systemPrompt: "Sender.",
      tools: ["send_message"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const incoming = bus.waitFor("agent-b", {
      fromAgentId: "agent-a",
      correlationId: "corr-req-1",
    });
    const session = new Session({ id: "s-ma2", projectId: "p-ma" });
    const agentA = await Agent.load("agent-a", rt, { session });
    await agentA.run("go");

    const msg = await incoming;
    expect(msg.type).toBe("request");
    expect(msg.correlationId).toBe("corr-req-1");
    expect(msg.payload).toEqual({ ask: "status" });
  });
});
