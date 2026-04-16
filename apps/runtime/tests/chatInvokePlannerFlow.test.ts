/**
 * End-to-end contract for **chat session** + **`invoke_planner`** + **`runtime_fetch_run`**
 * (see `docs/chat-runs-and-planner.md`): same `sessionId` on the chat agent, planner job carries
 * `invokedBySessionId`, worker persistence is simulated by seeding {@link RunStore} before fetch.
 */
import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import type { EngineJobPayload, Run, RunStore } from "@opencoreagents/core";
import {
  InMemoryMemoryAdapter,
  ToolRunner,
  clearAllRegistriesForTests,
  resolveToolRegistry,
  type ToolContext,
} from "@opencoreagents/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import type { ResolvedRuntimeStackConfig } from "../src/config/types.js";
import {
  RUNTIME_FETCH_RUN_TOOL_ID,
  registerRuntimeFetchRunTool,
} from "../src/runtime/fetchRunTool.js";
import {
  RUNTIME_INVOKE_PLANNER_TOOL_ID,
  registerRuntimeInvokePlannerTool,
} from "../src/runtime/invokePlannerTool.js";
import { extractInvokedByChatSessionIdFromJobPayload } from "../src/redis/runEventRedis.js";

const PROJECT = "proj-chat-flow";

function mockStoreWithAgents(ids: string[]): DynamicDefinitionsStore {
  return {
    methods: {
      listAgents: vi.fn().mockImplementation(async (projectId: string) =>
        ids.map((id) => ({ id, projectId })),
      ),
    },
    Agent: { define: vi.fn().mockResolvedValue(undefined) },
  } as unknown as DynamicDefinitionsStore;
}

function chatToolCtx(over: Partial<ToolContext> & Pick<ToolContext, "runId" | "sessionId">): ToolContext {
  return {
    projectId: PROJECT,
    agentId: "chat",
    runId: over.runId,
    sessionId: over.sessionId,
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext: {
      principalId: "internal",
      kind: "internal",
      organizationId: PROJECT,
      projectId: PROJECT,
      roles: ["agent"],
      scopes: ["*"],
    },
    ...over,
  };
}

function makeRunStore(runs: Map<string, Run>): RunStore {
  return {
    load: async (runId: string) => runs.get(runId) ?? null,
    save: vi.fn(),
    saveIfStatus: vi.fn(),
    delete: vi.fn(),
    listByAgent: vi.fn(),
  } as unknown as RunStore;
}

function plannerRun(
  runId: string,
  over: Partial<Run> & Pick<Run, "status">,
): Run {
  return {
    runId,
    agentId: "planner",
    sessionId: "planner-internal-sess",
    projectId: PROJECT,
    history:
      over.status === "completed"
        ? [{ type: "result", content: "Planner done: subtasks outlined." }]
        : [],
    state: { iteration: 1, pending: null },
    ...over,
  };
}

async function registerChatPlannerTools(options: {
  store: DynamicDefinitionsStore;
  config: ResolvedRuntimeStackConfig;
  enqueueRun: ReturnType<typeof vi.fn>;
  runStore: RunStore;
}) {
  await registerRuntimeInvokePlannerTool({
    definitionsStore: options.store,
    config: options.config,
    enqueueRun: options.enqueueRun,
    defaultPlannerAgentId: options.config.planner.defaultAgent.id,
  });
  await registerRuntimeFetchRunTool({ runStore: options.runStore });
}

describe("chat + invoke_planner + runtime_fetch_run flow", () => {
  let config: ResolvedRuntimeStackConfig;
  let enqueueRun: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clearAllRegistriesForTests();
    config = {
      ...defaultStackConfig,
      project: { ...defaultStackConfig.project, id: PROJECT },
      planner: {
        ...defaultStackConfig.planner,
        defaultAgent: { ...defaultStackConfig.planner.defaultAgent, id: "planner" },
      },
    };
    enqueueRun = vi.fn().mockResolvedValue({ id: "job-planner-1" });
  });

  it("turn1 invoke_planner links chat session; turn2 fetch_run reads persisted planner run", async () => {
    const runs = new Map<string, Run>();
    const runStore = makeRunStore(runs);
    const store = mockStoreWithAgents(["planner", "chat"]);
    await registerChatPlannerTools({ store, config, enqueueRun, runStore });

    const chatSessionId = "sess-user-thread-7";
    const runner = new ToolRunner(
      resolveToolRegistry(PROJECT),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID, RUNTIME_FETCH_RUN_TOOL_ID]),
    );

    const queued = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "Research and delegate" },
      chatToolCtx({ runId: "run-chat-first", sessionId: chatSessionId }),
    )) as Record<string, unknown>;

    expect(queued.status).toBe("queued");
    const plannerRunId = String(queued.runId);
    expect(plannerRunId).toMatch(/^run-invoke-planner-/);

    const [payload] = enqueueRun.mock.calls[0] as [Record<string, unknown>];
    expect(payload.sessionContext).toEqual({
      invokedByAgentId: "chat",
      invokedByRunId: "run-chat-first",
      invokedBySessionId: chatSessionId,
    });
    expect(String(payload.sessionId)).toMatch(/^planner-invoke-/);

    runs.set(plannerRunId, plannerRun(plannerRunId, { status: "completed" }));

    const fetched = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: plannerRunId },
      chatToolCtx({
        runId: "run-chat-second",
        sessionId: chatSessionId,
      }),
    )) as Record<string, unknown>;

    expect(fetched.ok).toBe(true);
    expect(fetched.status).toBe("completed");
    expect(fetched.reply).toBe("Planner done: subtasks outlined.");
    expect(fetched.agentId).toBe("planner");
  });

  it("fetch_run on follow-up turn sees running planner until worker persists completion", async () => {
    const runs = new Map<string, Run>();
    const runStore = makeRunStore(runs);
    const store = mockStoreWithAgents(["planner", "chat"]);
    await registerChatPlannerTools({ store, config, enqueueRun, runStore });

    const sessionId = "sess-poll-1";
    const runner = new ToolRunner(
      resolveToolRegistry(PROJECT),
      new Set([RUNTIME_INVOKE_PLANNER_TOOL_ID, RUNTIME_FETCH_RUN_TOOL_ID]),
    );

    const queued = (await runner.execute(
      RUNTIME_INVOKE_PLANNER_TOOL_ID,
      { goal: "Long task" },
      chatToolCtx({ runId: "r-chat-1", sessionId }),
    )) as Record<string, unknown>;
    const plannerRunId = String(queued.runId);

    runs.set(plannerRunId, plannerRun(plannerRunId, { status: "running", history: [] }));

    const mid = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: plannerRunId },
      chatToolCtx({ runId: "r-chat-2", sessionId }),
    )) as Record<string, unknown>;

    expect(mid.ok).toBe(true);
    expect(mid.status).toBe("running");
    expect(mid.reply).toBeUndefined();

    runs.set(plannerRunId, plannerRun(plannerRunId, { status: "completed" }));

    const done = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: plannerRunId },
      chatToolCtx({ runId: "r-chat-3", sessionId }),
    )) as Record<string, unknown>;

    expect(done.status).toBe("completed");
    expect(done.reply).toBe("Planner done: subtasks outlined.");
  });
});

describe("extractInvokedByChatSessionIdFromJobPayload (planner job → chat SSE)", () => {
  it("returns chat session id for run jobs enqueued like invoke_planner", () => {
    const payload: EngineJobPayload = {
      kind: "run",
      projectId: PROJECT,
      agentId: "planner",
      sessionId: "planner-invoke-abc",
      runId: "run-invoke-planner-xyz",
      userInput: "goal",
      sessionContext: {
        invokedByAgentId: "chat",
        invokedByRunId: "run-chat-1",
        invokedBySessionId: "sess-from-chat-ui",
      },
    };
    expect(extractInvokedByChatSessionIdFromJobPayload(payload)).toBe("sess-from-chat-ui");
  });

  it("returns undefined for continue / resume (no planner invoke bridge)", () => {
    const cont: EngineJobPayload = {
      kind: "continue",
      projectId: PROJECT,
      agentId: "chat",
      sessionId: "s",
      runId: "r1",
      userInput: "hi",
      sessionContext: { invokedBySessionId: "should-not-matter" },
    };
    expect(extractInvokedByChatSessionIdFromJobPayload(cont)).toBeUndefined();

    const resume: EngineJobPayload = {
      kind: "resume",
      projectId: PROJECT,
      agentId: "chat",
      sessionId: "s",
      runId: "r1",
      resumeInput: { type: "text", content: "ok" },
    };
    expect(extractInvokedByChatSessionIdFromJobPayload(resume)).toBeUndefined();
  });

  it("returns undefined when invokedBySessionId missing or blank", () => {
    const noCtx: EngineJobPayload = {
      kind: "run",
      projectId: PROJECT,
      agentId: "planner",
      sessionId: "p",
      userInput: "g",
    };
    expect(extractInvokedByChatSessionIdFromJobPayload(noCtx)).toBeUndefined();

    const blank: EngineJobPayload = {
      kind: "run",
      projectId: PROJECT,
      agentId: "planner",
      sessionId: "p",
      userInput: "g",
      sessionContext: { invokedBySessionId: "   " },
    };
    expect(extractInvokedByChatSessionIdFromJobPayload(blank)).toBeUndefined();
  });
});
