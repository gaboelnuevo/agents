import { describe, it, expect } from "vitest";
import {
  applyRuntimeToolAllowlist,
  Agent,
  AgentRuntime,
  Session,
  ToolNotAllowedError,
  InMemoryMemoryAdapter,
  buildEngineDeps,
  getAgentDefinition,
  clearAllRegistriesForTests,
} from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

describe("applyRuntimeToolAllowlist", () => {
  const agentTools = new Set(["a", "b", "c"]);

  it("leaves agent tools unchanged when runtime constraint is undefined", () => {
    expect(applyRuntimeToolAllowlist(agentTools, undefined)).toEqual(agentTools);
  });

  it('leaves agent tools unchanged when runtime constraint is "*"', () => {
    expect(applyRuntimeToolAllowlist(agentTools, "*")).toEqual(agentTools);
  });

  it("intersects with a Set", () => {
    expect(applyRuntimeToolAllowlist(agentTools, new Set(["b", "c", "x"]))).toEqual(
      new Set(["b", "c"]),
    );
  });

  it("intersects with an array", () => {
    expect(applyRuntimeToolAllowlist(agentTools, ["b"])).toEqual(new Set(["b"]));
  });

  it("returns empty when intersection is empty", () => {
    expect(applyRuntimeToolAllowlist(agentTools, ["x"])).toEqual(new Set());
  });
});

describe("buildEngineDeps + allowedToolIds", () => {
  it("rejects tools not in runtime allowlist even if agent lists them", async () => {
    clearAllRegistriesForTests();

    class DummyLlm implements LLMAdapter {
      async generate(_req: LLMRequest): Promise<LLMResponse> {
        return { content: "{}" };
      }
    }

    const rt = new AgentRuntime({
      llmAdapter: new DummyLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
      allowedToolIds: ["save_memory"],
    });

    await Agent.define({
      id: "t1",
      projectId: "p-rta",
      systemPrompt: "Test.",
      tools: ["save_memory", "get_memory"],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const agentDef = getAgentDefinition("p-rta", "t1");
    expect(agentDef).toBeDefined();
    const session = new Session({ id: "s1", projectId: "p-rta" });
    const deps = buildEngineDeps(agentDef!, session, rt);

    await expect(
      deps.toolRunner.execute(
        "get_memory",
        { memoryType: "longTerm" },
        {
          projectId: "p-rta",
          agentId: "t1",
          runId: "r1",
          sessionId: "s1",
          memoryAdapter: deps.memoryAdapter,
          securityContext: deps.securityContext,
        },
      ),
    ).rejects.toThrow(ToolNotAllowedError);

    const out = await deps.toolRunner.execute(
      "save_memory",
      { memoryType: "longTerm", content: { n: 1 } },
      {
        projectId: "p-rta",
        agentId: "t1",
        runId: "r1",
        sessionId: "s1",
        memoryAdapter: deps.memoryAdapter,
        securityContext: deps.securityContext,
      },
    );
    expect(out).toEqual({ success: true });
  });
});
