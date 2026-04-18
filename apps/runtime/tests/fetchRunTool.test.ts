import type { Run, RunStore } from "@opencoreagents/core";
import {
  InMemoryMemoryAdapter,
  ToolRunner,
  clearAllRegistriesForTests,
  resolveToolRegistry,
  type ToolContext,
} from "@opencoreagents/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_FETCH_RUN_TOOL_ID,
  lastInvokePlannerRunIdFromCallerHistory,
  registerRuntimeFetchRunTool,
} from "../src/runtime/fetchRunTool.js";
import { RUNTIME_INVOKE_PLANNER_TOOL_ID } from "../src/runtime/invokePlannerTool.js";

function ctx(projectId: string): ToolContext {
  return {
    projectId,
    agentId: "chat",
    runId: "r1",
    sessionId: "s1",
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext: {
      principalId: "internal",
      kind: "internal",
      organizationId: projectId,
      projectId,
      roles: ["agent"],
      scopes: ["*"],
    },
  };
}

function minimalRun(over: Partial<Run>): Run {
  return {
    runId: "run-planner-1",
    agentId: "planner",
    sessionId: "planner-sess",
    status: "completed",
    history: [{ type: "result", content: "Final answer" }],
    state: { iteration: 1, pending: null },
    ...over,
  };
}

describe("registerRuntimeFetchRunTool", () => {
  beforeEach(() => {
    clearAllRegistriesForTests();
  });

  it("returns ok summary when run exists for same project", async () => {
    const run = minimalRun({ projectId: "p1" });
    const runStore = {
      load: vi.fn().mockResolvedValue(run),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;

    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: run.runId },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(out.status).toBe("completed");
    expect(String(out.statusSummary)).toMatch(/completed/);
    expect(out.reply).toBe("Final answer");
    expect(out.historyStepCount).toBe(1);
    expect(out.agentId).toBe("planner");
    expect(runStore.load).toHaveBeenCalledWith(run.runId);
  });

  it("includes failedReason when run failed with persisted engine message", async () => {
    const run = minimalRun({
      projectId: "p1",
      status: "failed",
      history: [],
      state: {
        iteration: 0,
        pending: null,
        failedReason: "Exceeded parse recovery attempts",
      },
    });
    const runStore = {
      load: vi.fn().mockResolvedValue(run),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;

    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: run.runId },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(out.status).toBe("failed");
    expect(String(out.statusSummary)).toMatch(/failed/);
    expect(String(out.statusSummary)).toMatch(/do not catastrophize|Status:/);
    expect(out.failedReason).toBe("Exceeded parse recovery attempts");
    expect(out.historyStepCount).toBe(0);
    expect(typeof out.hint).toBe("string");
    expect(String(out.hint)).toContain("RUNTIME_ENGINE_MAX_PARSE_RECOVERY");
  });

  it("omits hint when failed with history (not an early-parse-only failure)", async () => {
    const run = minimalRun({
      projectId: "p1",
      status: "failed",
      history: [{ type: "thought", content: "x" }],
      state: {
        iteration: 1,
        pending: null,
        failedReason: "[STEP_SCHEMA_ERROR] Exceeded parse recovery attempts",
      },
    });
    const runStore = {
      load: vi.fn().mockResolvedValue(run),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;

    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: run.runId },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.hint).toBeUndefined();
  });

  it("returns ok when run has no projectId (legacy rows)", async () => {
    const run = minimalRun({ projectId: undefined });
    const runStore = {
      load: vi.fn().mockResolvedValue(run),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: run.runId },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.ok).toBe(true);
  });

  it("returns not found when load is null", async () => {
    const runStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: "missing" },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.ok).toBe(false);
    expect(out.error).toBe("run not found");
  });

  it("rejects cross-project run when projectId is set", async () => {
    const run = minimalRun({ projectId: "other" });
    const runStore = {
      load: vi.fn().mockResolvedValue(run),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(
      RUNTIME_FETCH_RUN_TOOL_ID,
      { runId: run.runId },
      ctx("p1"),
    )) as Record<string, unknown>;

    expect(out.ok).toBe(false);
    expect(out.error).toBe("run belongs to a different project");
  });

  it("throws when runId omitted and caller history has no invoke_planner", async () => {
    const caller: Run = {
      runId: "r1",
      agentId: "chat",
      status: "running",
      projectId: "p1",
      history: [],
      state: { iteration: 0, pending: null },
    };
    const runStore = {
      load: vi.fn().mockImplementation(async (id: string) => (id === "r1" ? caller : null)),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    await expect(
      runner.execute(RUNTIME_FETCH_RUN_TOOL_ID, { runId: "  " }, ctx("p1")),
    ).rejects.toThrow(/no planner runId found in caller history/);
    await expect(runner.execute(RUNTIME_FETCH_RUN_TOOL_ID, {}, ctx("p1"))).rejects.toThrow(
      /no planner runId found in caller history/,
    );
  });

  it("resolves planner runId from caller history when runId omitted", async () => {
    const plannerRunId = "run-invoke-planner-test-111";
    const caller: Run = {
      runId: "r1",
      agentId: "chat",
      status: "running",
      projectId: "p1",
      history: [
        {
          type: "action",
          content: { tool: RUNTIME_INVOKE_PLANNER_TOOL_ID, input: { goal: "x" } },
          meta: { ts: "1", source: "llm" },
        },
        {
          type: "observation",
          content: {
            jobId: "j1",
            runId: plannerRunId,
            sessionId: "planner-invoke-x",
            plannerAgentId: "planner",
            status: "queued",
          },
          meta: { ts: "2", source: "tool" },
        },
      ],
      state: { iteration: 0, pending: null },
    };
    const planner = minimalRun({
      runId: plannerRunId,
      projectId: "p1",
      agentId: "planner",
    });
    const runStore = {
      load: vi.fn().mockImplementation(async (id: string) => {
        if (id === "r1") return caller;
        if (id === plannerRunId) return planner;
        return null;
      }),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    const out = (await runner.execute(RUNTIME_FETCH_RUN_TOOL_ID, {}, ctx("p1"))) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.runId).toBe(plannerRunId);
    expect(runStore.load).toHaveBeenCalledWith("r1");
    expect(runStore.load).toHaveBeenCalledWith(plannerRunId);
  });
});

describe("lastInvokePlannerRunIdFromCallerHistory", () => {
  it("returns undefined for empty or missing history", () => {
    expect(lastInvokePlannerRunIdFromCallerHistory(undefined)).toBeUndefined();
    expect(lastInvokePlannerRunIdFromCallerHistory([])).toBeUndefined();
  });

  it("returns the latest invoke_planner runId when several enqueues exist", () => {
    const first = "run-invoke-planner-aaa";
    const second = "run-invoke-planner-bbb";
    const history: Run["history"] = [
      {
        type: "action",
        content: { tool: RUNTIME_INVOKE_PLANNER_TOOL_ID, input: { goal: "a" } },
        meta: { ts: "1", source: "llm" },
      },
      {
        type: "observation",
        content: { runId: first, status: "queued" },
        meta: { ts: "2", source: "tool" },
      },
      {
        type: "action",
        content: { tool: RUNTIME_INVOKE_PLANNER_TOOL_ID, input: { goal: "b" } },
        meta: { ts: "3", source: "llm" },
      },
      {
        type: "observation",
        content: { runId: second, status: "queued" },
        meta: { ts: "4", source: "tool" },
      },
    ];
    expect(lastInvokePlannerRunIdFromCallerHistory(history)).toBe(second);
  });
});
