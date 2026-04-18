import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearAllRegistriesForTests,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  resolveToolRegistry,
  type Run,
  type ToolContext,
} from "@opencoreagents/core";
import { InMemoryDynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import { registerDynamicPlannerTools } from "../src/registerDynamicPlannerTools.js";

const securityContext = {
  principalId: "test",
  kind: "internal" as const,
  organizationId: "org",
  projectId: "p1",
  roles: [] as string[],
  scopes: [] as string[],
};

function baseToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    projectId: "p1",
    agentId: "planner",
    runId: "planner-run",
    sessionId: "sess-1",
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext,
    ...overrides,
  };
}

beforeEach(() => {
  clearAllRegistriesForTests();
});

describe("registerDynamicPlannerTools", () => {
  it("wait_for_agents returns completed results from runStore", async () => {
    const runStore = new InMemoryRunStore();
    const definitionsStore = new InMemoryDynamicDefinitionsStore();
    const enqueueRun = vi.fn().mockResolvedValue({ id: "job-1" });

    await registerDynamicPlannerTools({
      definitionsStore,
      runStore,
      enqueueRun,
      defaultSubAgentLlm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const runId = "run-sub-1";
    const run: Run = {
      runId,
      agentId: "sub",
      sessionId: "s",
      projectId: "p1",
      status: "completed",
      history: [
        {
          type: "result",
          content: "hello from sub",
          meta: { ts: new Date().toISOString(), source: "llm" },
        },
      ],
      state: { iteration: 1, pending: null, parseAttempts: 0 },
    };
    await runStore.save(run);

    const reg = resolveToolRegistry("p1");
    const tool = reg.get("wait_for_agents");
    expect(tool).toBeDefined();

    const out = (await tool!.execute(
      { runIds: [runId], timeoutMs: 5_000, failOnAny: false },
      baseToolContext(),
    )) as {
      results: Record<string, string>;
      errors: Record<string, string>;
      allCompleted: boolean;
    };

    expect(out.results[runId]).toBe("hello from sub");
    expect(out.allCompleted).toBe(true);
    expect(Object.keys(out.errors)).toHaveLength(0);
  });

  it("spawn_agent enqueues with deterministic runId and defines the agent", async () => {
    const runStore = new InMemoryRunStore();
    const definitionsStore = new InMemoryDynamicDefinitionsStore();
    const enqueueRun = vi.fn().mockResolvedValue({ id: "jq-1" });

    await registerDynamicPlannerTools({
      definitionsStore,
      runStore,
      enqueueRun,
      defaultSubAgentLlm: { provider: "anthropic", model: "claude-sonnet-4-6" },
      maxPlannerDepth: 2,
    });

    const reg = resolveToolRegistry("p1");
    const tool = reg.get("spawn_agent");

    const before = Date.now();
    const out = (await tool!.execute(
      {
        agentId: "analyst-001",
        systemPrompt: "You analyze data.",
        tools: ["system_get_memory"],
        input: "Do the thing",
      },
      baseToolContext({ sessionContext: { plannerDepth: 0 } }),
    )) as { runId: string; jobId: string; agentId: string };

    expect(out.agentId).toBe("analyst-001");
    expect(out.runId.startsWith("run-analyst-001-")).toBe(true);
    expect(Number(out.runId.split("-").pop())).toBeGreaterThanOrEqual(before);

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const payload = enqueueRun.mock.calls[0]![0] as {
      runId: string;
      userInput: string;
      sessionContext: Record<string, unknown>;
    };
    expect(payload.runId).toBe(out.runId);
    expect(payload.userInput).toBe("Do the thing");
    expect(payload.sessionContext.plannerDepth).toBe(1);

    const agents = await definitionsStore.methods.listAgents("p1");
    expect(agents.some((a) => a.id === "analyst-001")).toBe(true);
  });

  it("spawn_agent rejects invoke_planner for sub-agents", async () => {
    const definitionsStore = new InMemoryDynamicDefinitionsStore();
    await registerDynamicPlannerTools({
      definitionsStore,
      runStore: new InMemoryRunStore(),
      enqueueRun: vi.fn(),
      defaultSubAgentLlm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const tool = resolveToolRegistry("p1").get("spawn_agent")!;
    await expect(
      tool.execute(
        {
          agentId: "bad",
          systemPrompt: "x",
          tools: ["invoke_planner"],
          input: "y",
        },
        baseToolContext(),
      ),
    ).rejects.toThrow(/not allowed for sub-agents/);
  });

  it("spawn_agent rejects forbidden tools for sub-agents", async () => {
    const definitionsStore = new InMemoryDynamicDefinitionsStore();
    await registerDynamicPlannerTools({
      definitionsStore,
      runStore: new InMemoryRunStore(),
      enqueueRun: vi.fn(),
      defaultSubAgentLlm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const tool = resolveToolRegistry("p1").get("spawn_agent")!;
    await expect(
      tool.execute(
        {
          agentId: "bad",
          systemPrompt: "x",
          tools: ["spawn_agent"],
          input: "y",
        },
        baseToolContext(),
      ),
    ).rejects.toThrow(/not allowed for sub-agents/);
  });

  it("list_available_models returns deployment defaults when no catalog is registered", async () => {
    await registerDynamicPlannerTools({
      definitionsStore: new InMemoryDynamicDefinitionsStore(),
      runStore: new InMemoryRunStore(),
      enqueueRun: vi.fn(),
      defaultSubAgentLlm: { provider: "openai", model: "my-proxy-default" },
    });

    const tool = resolveToolRegistry("p1").get("list_available_models")!;
    const out = (await tool.execute({}, baseToolContext())) as {
      models: unknown[];
      total: number;
      configuredProviders: string[];
      defaultSubAgentLlm: { provider: string; model: string };
      note: string;
    };

    expect(out.models).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.configuredProviders).toEqual(["openai"]);
    expect(out.defaultSubAgentLlm).toEqual({ provider: "openai", model: "my-proxy-default" });
    expect(out.note).toMatch(/No explicit model catalog is registered/);
  });

  it("list_available_models supports custom providers through a resolver", async () => {
    const resolveAvailableModels = vi.fn().mockResolvedValue([
      {
        provider: "gateway",
        model: "acme-pro",
        alias: "pro",
        tier: "flagship",
        costRelative: "high",
        contextWindow: 128_000,
        strengths: ["reasoning"],
        recommended: ["hard tasks"],
        avoid: ["cheap fan-out"],
      },
    ]);

    await registerDynamicPlannerTools({
      definitionsStore: new InMemoryDynamicDefinitionsStore(),
      runStore: new InMemoryRunStore(),
      enqueueRun: vi.fn(),
      defaultSubAgentLlm: { provider: "gateway", model: "acme-default" },
      resolveAvailableModels,
    });

    const tool = resolveToolRegistry("p1").get("list_available_models")!;
    const out = (await tool.execute(
      { provider: "gateway" },
      baseToolContext(),
    )) as {
      models: Array<{ provider: string; model: string; sourceRoles?: string[] }>;
      total: number;
      configuredProviders: string[];
      roles: Record<string, string[]>;
    };

    expect(resolveAvailableModels).toHaveBeenCalledWith({
      provider: "gateway",
      ctx: expect.objectContaining({ projectId: "p1", runId: "planner-run" }),
    });
    expect(out.total).toBe(1);
    expect(out.models[0]).toMatchObject({ provider: "gateway", model: "acme-pro" });
    expect(out.configuredProviders).toEqual(["gateway"]);
    expect(out.roles).toEqual({ "gateway:acme-pro": [] });
  });
});
