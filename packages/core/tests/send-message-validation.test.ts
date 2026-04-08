import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryMemoryAdapter,
  InProcessMessageBus,
  AgentRuntime,
  clearAllRegistriesForTests,
} from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";
import type { ToolContext } from "../src/adapters/tool/ToolAdapter.js";
import { ToolRunner } from "../src/tools/ToolRunner.js";
import { resolveToolRegistry } from "../src/define/registry.js";
import {
  ToolExecutionError,
  ToolValidationError,
} from "../src/errors/index.js";

class DummyLLM implements LLMAdapter {
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    return { content: "{}" };
  }
}

function toolCtx(agentId: string, rt: AgentRuntime): ToolContext {
  const c = rt.config;
  return {
    projectId: "p1",
    agentId,
    runId: "r1",
    sessionId: "s1",
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext: {
      principalId: "internal",
      kind: "internal",
      organizationId: "p1",
      projectId: "p1",
      roles: ["agent"],
      scopes: ["*"],
    },
    messageBus: c.messageBus,
    sendMessageTargetPolicy: c.sendMessageTargetPolicy,
  };
}

describe("send_message validate + execute guards", () => {
  let runner: ToolRunner;
  let rt: AgentRuntime;

  beforeEach(() => {
    clearAllRegistriesForTests();
    rt = new AgentRuntime({
      llmAdapter: new DummyLLM(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      messageBus: new InProcessMessageBus(),
    });
    runner = new ToolRunner(resolveToolRegistry("p1"), new Set(["send_message"]));
  });

  it("accepts a valid event payload", async () => {
    const out = await runner.execute(
      "send_message",
      { toAgentId: "agent-b", type: "event", payload: { x: 1 } },
      toolCtx("agent-a", rt),
    );
    expect(out).toEqual({ success: true, sentTo: "agent-b" });
  });

  it("trims toAgentId and correlationId", async () => {
    const out = await runner.execute(
      "send_message",
      {
        toAgentId: "  agent-b  ",
        type: "request",
        correlationId: "  c1  ",
        payload: {},
      },
      toolCtx("agent-a", rt),
    );
    expect(out).toEqual({ success: true, sentTo: "agent-b" });
  });

  it("rejects invalid input via validate", async () => {
    await expect(
      runner.execute("send_message", { toAgentId: "", payload: {} }, toolCtx("agent-a", rt)),
    ).rejects.toThrow(ToolValidationError);
    await expect(
      runner.execute(
        "send_message",
        { toAgentId: "b", type: "request", payload: {} },
        toolCtx("agent-a", rt),
      ),
    ).rejects.toThrow(ToolValidationError);
    await expect(
      runner.execute("send_message", { toAgentId: "b" }, toolCtx("agent-a", rt)),
    ).rejects.toThrow(ToolValidationError);
  });

  it("rejects send to self after validate", async () => {
    await expect(
      runner.execute("send_message", { toAgentId: "agent-a", payload: {} }, toolCtx("agent-a", rt)),
    ).rejects.toThrow(ToolExecutionError);
  });

  it("denies when sendMessageTargetPolicy returns false", async () => {
    clearAllRegistriesForTests();
    rt = new AgentRuntime({
      llmAdapter: new DummyLLM(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      messageBus: new InProcessMessageBus(),
      sendMessageTargetPolicy: () => false,
    });
    const r = new ToolRunner(resolveToolRegistry("p1"), new Set(["send_message"]));
    await expect(
      r.execute(
        "send_message",
        { toAgentId: "agent-b", payload: {} },
        toolCtx("agent-a", rt),
      ),
    ).rejects.toThrow(ToolExecutionError);
  });

  it("allows only targets approved by sendMessageTargetPolicy", async () => {
    clearAllRegistriesForTests();
    rt = new AgentRuntime({
      llmAdapter: new DummyLLM(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      messageBus: new InProcessMessageBus(),
      sendMessageTargetPolicy: ({ toAgentId }) => toAgentId === "allowed",
    });
    const r = new ToolRunner(resolveToolRegistry("p1"), new Set(["send_message"]));
    await expect(
      r.execute("send_message", { toAgentId: "other", payload: {} }, toolCtx("agent-a", rt)),
    ).rejects.toThrow(ToolExecutionError);
    const ok = await r.execute(
      "send_message",
      { toAgentId: "allowed", payload: {} },
      toolCtx("agent-a", rt),
    );
    expect(ok).toEqual({ success: true, sentTo: "allowed" });
  });
});
