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
  registerRuntimeFetchRunTool,
} from "../src/runtime/fetchRunTool.js";

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
    expect(out.failedReason).toBe("Exceeded parse recovery attempts");
    expect(out.historyStepCount).toBe(0);
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

  it("throws on empty runId", async () => {
    const runStore = {
      load: vi.fn(),
      save: vi.fn(),
      saveIfStatus: vi.fn(),
      delete: vi.fn(),
      listByAgent: vi.fn(),
    } as unknown as RunStore;
    await registerRuntimeFetchRunTool({ runStore });
    const runner = new ToolRunner(resolveToolRegistry("p1"), new Set([RUNTIME_FETCH_RUN_TOOL_ID]));

    await expect(
      runner.execute(RUNTIME_FETCH_RUN_TOOL_ID, { runId: "  " }, ctx("p1")),
    ).rejects.toThrow(/runId is required/);
  });
});
