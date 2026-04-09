import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Agent,
  AgentRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  clearAllRegistriesForTests,
} from "@agent-runtime/core";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  ConversationGateway,
  findWaitingRunIdFromRunStore,
} from "../src/index.js";

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

describe("ConversationGateway", () => {
  it("runs agent and sends reply via outbound", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t" }),
      JSON.stringify({ type: "result", content: "Hello" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
    });

    await Agent.define({
      id: "g1",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const seen = new Set<string>();
    const sendReply = vi.fn();
    const gateway = new ConversationGateway({
      runtime: rt,
      agentId: "g1",
      resolveSession: (key) => ({ sessionId: `s-${key}`, projectId: "p1" }),
      findWaitingRunId: async () => undefined,
      outbound: { sendReply },
      idempotency: {
        seen: (id) => seen.has(id),
        markProcessed: (id) => void seen.add(id),
      },
    });

    await gateway.handleInbound({
      conversationKey: "c1",
      text: "Hi",
      externalMessageId: "m1",
      receivedAt: new Date().toISOString(),
    });

    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0]![1]).toBe("Hello");
  });

  it("skips duplicate externalMessageId", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "result", content: "Once" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
    });

    await Agent.define({
      id: "g2",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const seen = new Set<string>();
    const sendReply = vi.fn();
    const gateway = new ConversationGateway({
      runtime: rt,
      agentId: "g2",
      resolveSession: (key) => ({ sessionId: `s-${key}`, projectId: "p1" }),
      findWaitingRunId: async () => undefined,
      outbound: { sendReply },
      idempotency: {
        seen: (id) => seen.has(id),
        markProcessed: (id) => void seen.add(id),
      },
    });

    const msg = {
      conversationKey: "c1",
      text: "Hi",
      externalMessageId: "dup",
      receivedAt: new Date().toISOString(),
    };
    await gateway.handleInbound(msg);
    await gateway.handleInbound(msg);
    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it("discards when text exceeds maxTextLength", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([JSON.stringify({ type: "result", content: "no" })]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      maxIterations: 10,
    });

    await Agent.define({
      id: "g3",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const onDiscard = vi.fn();
    const sendReply = vi.fn();
    const gateway = new ConversationGateway({
      runtime: rt,
      agentId: "g3",
      resolveSession: (key) => ({ sessionId: `s-${key}`, projectId: "p1" }),
      findWaitingRunId: async () => undefined,
      outbound: { sendReply },
      idempotency: {
        seen: () => false,
        markProcessed: () => {},
      },
      limits: { maxTextLength: 2 },
      hooks: { onDiscard },
    });

    await gateway.handleInbound({
      conversationKey: "c1",
      text: "too long",
      externalMessageId: "m1",
      receivedAt: new Date().toISOString(),
    });

    expect(onDiscard).toHaveBeenCalledWith("text_too_long", expect.any(Object));
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("resumes when findWaitingRunId returns a runId", async () => {
    const mem = new InMemoryMemoryAdapter();
    const store = new InMemoryRunStore();
    const llm = new QueueLLM([
      JSON.stringify({ type: "wait", reason: "tool" }),
      JSON.stringify({ type: "result", content: "resumed" }),
    ]);
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: mem,
      runStore: store,
      maxIterations: 10,
    });

    await Agent.define({
      id: "g4",
      projectId: "p1",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const seen = new Set<string>();
    const sendReply = vi.fn();
    const gateway = new ConversationGateway({
      runtime: rt,
      agentId: "g4",
      resolveSession: () => ({ sessionId: "s-w", projectId: "p1" }),
      findWaitingRunId: (sid, aid) =>
        findWaitingRunIdFromRunStore(store, sid, aid),
      outbound: { sendReply },
      idempotency: {
        seen: (id) => seen.has(id),
        markProcessed: (id) => void seen.add(id),
      },
    });

    await gateway.handleInbound({
      conversationKey: "c-w",
      text: "start",
      externalMessageId: "m-a",
      receivedAt: new Date().toISOString(),
    });
    // Run ends in `waiting`: no `result` step yet — outbound may receive an empty reply.
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0]![1]).toBe("");

    await gateway.handleInbound({
      conversationKey: "c-w",
      text: "continue",
      externalMessageId: "m-b",
      receivedAt: new Date().toISOString(),
    });
    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(sendReply.mock.calls[1]![1]).toBe("resumed");
  });
});
