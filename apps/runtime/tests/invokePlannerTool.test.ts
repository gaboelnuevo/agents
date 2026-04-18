import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import {
  InMemoryMemoryAdapter,
  ToolRunner,
  clearAllRegistriesForTests,
  resolveToolRegistry,
  type Run,
  type RunStore,
  type ToolContext,
} from "@opencoreagents/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import {
  RUNTIME_INVOKE_PLANNER_TOOL_ID,
  countInvokePlannerActionsInRun,
  registerRuntimeInvokePlannerTool,
} from "../src/runtime/invokePlannerTool.js";
import type { ResolvedRuntimeStackConfig } from "../src/config/types.js";

function toolCtx(over: Partial<ToolContext> & Pick<ToolContext, "agentId">): ToolContext {
  return {
    projectId: "proj-a",
    runId: "run-chat-1",
    sessionId: "sess-chat-1",
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext: {
      principalId: "internal",
      kind: "internal",
      organizationId: "proj-a",
      projectId: "proj-a",
      roles: ["agent"],
      scopes: ["*"],
    },
    ...over,
  };
}

function mockStoreWithAgents(ids: string[]): DynamicDefinitionsStore {
  return {
    methods: {
      listAgents: vi.fn().mockImplementation(async (projectId: string) =>
        ids.map((id) => ({ id, projectId })),
      ),
    },
  } as unknown as DynamicDefinitionsStore;
}

/** Caller run history with **n** completed `invoke_planner` actions (each followed by a dummy observation). */
function chatRunWithPlannerInvokeCount(runId: string, n: number): Run {
  const history: Run["history"] = [];
  for (let i = 0; i < n; i++) {
    history.push({
      type: "action",
      content: { tool: RUNTIME_INVOKE_PLANNER_TOOL_ID, input: { goal: `g${i}` } },
      meta: { ts: `t${i}a`, source: "llm" },
    });
    history.push({
      type: "observation",
      content: { ok: true },
      meta: { ts: `t${i}b`, source: "tool" },
    });
  }
  return {
    runId,
    agentId: "chat",
    sessionId: "sess-chat-1",
    projectId: "proj-a",
    status: "running",
    history,
    state: { iteration: n, pending: null },
  };
}

describe("registerRuntimeInvokePlannerTool (mocked enqueue + store)", () => {
  let config: ResolvedRuntimeStackConfig;
  let enqueueRun: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clearAllRegistriesForTests();
    config = {
      ...defaultStackConfig,
      planner: {
        ...defaultStackConfig.planner,
        defaultAgent: { ...defaultStackConfig.planner.defaultAgent, id: "planner" },
      },
    };
    enqueueRun = vi.fn().mockResolvedValue({ id: "job-mock-1" });
  });

  async function setupRegister(store: DynamicDefinitionsStore): Promise<{
    runner: ToolRunner;
    runStore: RunStore;
  }> {
    const runStore = {
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      saveIfStatus: vi.fn().mockResolvedValue(false),
      listByAgent: vi.fn().mockResolvedValue([]),
    } as unknown as RunStore;
    await registerRuntimeInvokePlannerTool({
      definitionsStore: store,
      config,
      runStore,
      enqueueRun,
      defaultPlannerAgentId: "planner",
    });
    const runner = new ToolRunner(
      resolveToolRegistry("proj-a"),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID]),
    );
    return { runner, runStore };
  }

  it("enqueues planner run with goal, sessionContext from caller, and planner-invoke session", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner, runStore } = await setupRegister(store);

    const out = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "Do the thing" },
      toolCtx({ agentId: "chat" }),
    )) as Record<string, unknown>;

    expect(out.status).toBe("queued");
    expect(out.jobId).toBe("job-mock-1");
    expect(out.plannerAgentId).toBe("planner");
    expect(out.runId).toMatch(/^run-invoke-planner-/);
    expect(out.sessionId).toMatch(/^planner-invoke-/);

    expect(runStore.save).toHaveBeenCalledTimes(1);
    const saved = (runStore.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      runId: string;
      agentId: string;
      status: string;
      state: { userInput: string };
    };
    expect(saved.runId).toBe(out.runId);
    expect(saved.agentId).toBe("planner");
    expect(saved.status).toBe("running");
    expect(saved.state.userInput).toBe("Do the thing");

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const [payload, opts] = enqueueRun.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    expect(payload.projectId).toBe("proj-a");
    expect(payload.agentId).toBe("planner");
    expect(payload.userInput).toBe("Do the thing");
    expect(payload.runId).toBe(out.runId);
    expect(payload.sessionId).toBe(out.sessionId);
    expect(payload.sessionContext).toEqual({
      invokedByAgentId: "chat",
      invokedByRunId: "run-chat-1",
      invokedBySessionId: "sess-chat-1",
    });
    expect(opts.priority).toBe(5);
    expect(opts.attempts).toBe(3);
  });

  it("accepts input as alias for goal", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner } = await setupRegister(store);

    await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { input: "via input" },
      toolCtx({ agentId: "chat" }),
    );

    const [payload] = enqueueRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload.userInput).toBe("via input");
  });

  it("maps priority high/low to BullMQ-style priority numbers", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner } = await setupRegister(store);

    await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "g", priority: "high" },
      toolCtx({ agentId: "chat" }),
    );
    expect((enqueueRun.mock.calls[0][1] as { priority: number }).priority).toBe(1);

    await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "g2", priority: "low" },
      toolCtx({ agentId: "chat" }),
    );
    expect((enqueueRun.mock.calls[1][1] as { priority: number }).priority).toBe(10);
  });

  it("rejects when caller is the planner agent", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner, runStore } = await setupRegister(store);

    await expect(
      runner.execute(
        RUNTIME_INVOKE_PLANNER_TOOL_ID,
        { goal: "x" },
        toolCtx({ agentId: "planner" }),
      ),
    ).rejects.toThrow(/cannot enqueue the planner agent from its own run/);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(runStore.save).not.toHaveBeenCalled();
  });

  it("rejects empty goal and input", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner, runStore } = await setupRegister(store);

    await expect(
      runner.execute(RUNTIME_INVOKE_PLANNER_TOOL_ID, {}, toolCtx({ agentId: "chat" })),
    ).rejects.toThrow(/goal.*input.*required/);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(runStore.save).not.toHaveBeenCalled();
  });

  it("throws when custom plannerAgentId is missing from definitions", async () => {
    const store = mockStoreWithAgents(["planner"]);
    const { runner, runStore } = await setupRegister(store);

    await expect(
      runner.execute(
        RUNTIME_INVOKE_PLANNER_TOOL_ID,
        { goal: "x", plannerAgentId: "other-planner" },
        toolCtx({ agentId: "chat" }),
      ),
    ).rejects.toThrow(/not defined for project/);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(runStore.save).not.toHaveBeenCalled();
  });

  it("seeds default planner via Agent.define when missing and seeding enabled", async () => {
    const listAgents = vi.fn().mockResolvedValue([]);
    const agentDefine = vi.fn().mockResolvedValue(undefined);
    const store = {
      methods: { listAgents },
      Agent: { define: agentDefine },
    } as unknown as DynamicDefinitionsStore;

    const { runner } = await setupRegister(store);

    await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "seed test" },
      toolCtx({ agentId: "chat" }),
    );

    expect(listAgents).toHaveBeenCalledWith("proj-a");
    expect(agentDefine).toHaveBeenCalled();
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const [payload] = enqueueRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload.userInput).toBe("seed test");
  });
});

describe("countInvokePlannerActionsInRun", () => {
  it("returns 0 for null, undefined, or empty history", () => {
    expect(countInvokePlannerActionsInRun(null)).toBe(0);
    expect(countInvokePlannerActionsInRun(undefined)).toBe(0);
    expect(
      countInvokePlannerActionsInRun({
        runId: "r",
        agentId: "chat",
        status: "running",
        history: [],
        state: { iteration: 0, pending: null },
      }),
    ).toBe(0);
  });

  it("counts only invoke_planner actions", () => {
    const run: Run = {
      runId: "r",
      agentId: "chat",
      status: "running",
      history: [
        {
          type: "action",
          content: { tool: "system_get_memory", input: {} },
          meta: { ts: "1", source: "llm" },
        },
        {
          type: "action",
          content: { tool: RUNTIME_INVOKE_PLANNER_TOOL_ID, input: { goal: "a" } },
          meta: { ts: "2", source: "llm" },
        },
        {
          type: "result",
          content: "done",
          meta: { ts: "3", source: "llm" },
        },
      ],
      state: { iteration: 0, pending: null },
    };
    expect(countInvokePlannerActionsInRun(run)).toBe(1);
  });
});

describe("invoke_planner per-caller-run limit (anti-loop)", () => {
  let config: ResolvedRuntimeStackConfig;
  let enqueueRun: ReturnType<typeof vi.fn>;

  afterEach(() => {
    delete process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN;
    delete process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN;
  });

  beforeEach(async () => {
    clearAllRegistriesForTests();
    config = {
      ...defaultStackConfig,
      planner: {
        ...defaultStackConfig.planner,
        defaultAgent: { ...defaultStackConfig.planner.defaultAgent, id: "planner" },
      },
    };
    enqueueRun = vi.fn().mockResolvedValue({ id: "job-mock-1" });
  });

  it("returns rejected without enqueue when caller run already hit the cap", async () => {
    process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN = "2";
    const callerRunId = "run-chat-saturated";
    const saturated = chatRunWithPlannerInvokeCount(callerRunId, 2);

    const runStore = {
      load: vi.fn().mockImplementation((id: string) => (id === callerRunId ? saturated : null)),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      saveIfStatus: vi.fn().mockResolvedValue(false),
      listByAgent: vi.fn().mockResolvedValue([]),
    } as unknown as RunStore;

    const store = mockStoreWithAgents(["planner"]);
    await registerRuntimeInvokePlannerTool({
      definitionsStore: store,
      config,
      runStore,
      enqueueRun,
      defaultPlannerAgentId: "planner",
    });
    const runner = new ToolRunner(
      resolveToolRegistry("proj-a"),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID]),
    );

    const out = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "another" },
      toolCtx({ agentId: "chat", runId: callerRunId }),
    )) as Record<string, unknown>;

    expect(out.rejected).toBe(true);
    expect(out.reason).toBe("max_invoke_planner_per_caller_run");
    expect(out.limit).toBe(2);
    expect(out.priorInvocations).toBe(2);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(runStore.save).not.toHaveBeenCalled();
  });

  it("prefers RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN over legacy CHAT_RUN when both set", async () => {
    process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CALLER_RUN = "1";
    process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN = "10";
    const callerRunId = "run-chat-pref";
    const oneInvoke = chatRunWithPlannerInvokeCount(callerRunId, 1);

    const runStore = {
      load: vi.fn().mockImplementation((id: string) => (id === callerRunId ? oneInvoke : null)),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      saveIfStatus: vi.fn().mockResolvedValue(false),
      listByAgent: vi.fn().mockResolvedValue([]),
    } as unknown as RunStore;

    const store = mockStoreWithAgents(["planner"]);
    await registerRuntimeInvokePlannerTool({
      definitionsStore: store,
      config,
      runStore,
      enqueueRun,
      defaultPlannerAgentId: "planner",
    });
    const runner = new ToolRunner(
      resolveToolRegistry("proj-a"),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID]),
    );

    const out = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "blocked" },
      toolCtx({ agentId: "chat", runId: callerRunId }),
    )) as Record<string, unknown>;

    expect(out.rejected).toBe(true);
    expect(out.limit).toBe(1);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("allows invoke when under cap", async () => {
    process.env.RUNTIME_INVOKE_PLANNER_MAX_PER_CHAT_RUN = "3";
    const callerRunId = "run-chat-ok";
    const partial = chatRunWithPlannerInvokeCount(callerRunId, 2);

    const runStore = {
      load: vi.fn().mockImplementation((id: string) => (id === callerRunId ? partial : null)),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      saveIfStatus: vi.fn().mockResolvedValue(false),
      listByAgent: vi.fn().mockResolvedValue([]),
    } as unknown as RunStore;

    const store = mockStoreWithAgents(["planner"]);
    await registerRuntimeInvokePlannerTool({
      definitionsStore: store,
      config,
      runStore,
      enqueueRun,
      defaultPlannerAgentId: "planner",
    });
    const runner = new ToolRunner(
      resolveToolRegistry("proj-a"),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID]),
    );

    const out = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "third allowed" },
      toolCtx({ agentId: "chat", runId: callerRunId }),
    )) as Record<string, unknown>;

    expect(out.rejected).toBeUndefined();
    expect(out.status).toBe("queued");
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });
});
