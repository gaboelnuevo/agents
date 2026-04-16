import type { Run } from "@opencoreagents/core";
import { InMemoryRunStore } from "@opencoreagents/core";
import { describe, expect, it } from "vitest";
import {
  continueInputsFromState,
  historyWithResumeTimeline,
  loadRunsForSession,
  parseQueryFlag,
  resumeInputsFromState,
} from "../src/runInspect.js";

function msg(
  type: Run["history"][number]["type"],
  content: unknown,
  ts = "2020-01-01T00:00:00.000Z",
): Run["history"][number] {
  return {
    type,
    content,
    meta: { ts, source: type === "observation" ? "tool" : "llm" },
  } as Run["history"][number];
}

describe("runInspect", () => {
  it("parseQueryFlag", () => {
    expect(parseQueryFlag("1")).toBe(true);
    expect(parseQueryFlag("true")).toBe(true);
    expect(parseQueryFlag("YES")).toBe(true);
    expect(parseQueryFlag("0")).toBe(false);
    expect(parseQueryFlag(undefined)).toBe(false);
  });

  it("historyWithResumeTimeline splices resume after each wait", () => {
    const run: Run = {
      runId: "r1",
      agentId: "a",
      sessionId: "s",
      status: "completed",
      history: [
        msg("thought", "t"),
        msg("wait", { reason: "need", details: {} }),
        msg("result", "done"),
      ],
      state: {
        iteration: 1,
        pending: null,
        userInput: "hi",
        resumeInputs: ["user-resume-text"],
      },
    };

    const merged = historyWithResumeTimeline(run);
    expect(merged).toHaveLength(4);
    expect(merged[2]!.type).toBe("observation");
    expect((merged[2]!.content as { kind: string; text: string }).kind).toBe("resume_input");
    expect((merged[2]!.content as { kind: string; text: string }).text).toBe("user-resume-text");
  });

  it("resumeInputsFromState / continueInputsFromState", () => {
    const run: Run = {
      runId: "r",
      agentId: "a",
      status: "completed",
      history: [],
      state: {
        iteration: 0,
        pending: null,
        resumeInputs: ["a"],
        continueInputs: ["b", "c"],
      },
    };
    expect(resumeInputsFromState(run)).toEqual(["a"]);
    expect(continueInputsFromState(run)).toEqual(["b", "c"]);
  });

  it("loadRunsForSession unions agents and filters session + project", async () => {
    const store = new InMemoryRunStore();
    const rChat: Run = {
      runId: "c1",
      agentId: "chat",
      sessionId: "sess-x",
      projectId: "p1",
      status: "completed",
      history: [msg("result", "hi")],
      state: { iteration: 1, pending: null, userInput: "u" },
    };
    const rPlanner: Run = {
      runId: "p1",
      agentId: "planner",
      sessionId: "sess-x",
      projectId: "p1",
      status: "running",
      history: [],
      state: { iteration: 0, pending: null },
    };
    const rOtherSession: Run = {
      runId: "o1",
      agentId: "chat",
      sessionId: "other",
      projectId: "p1",
      status: "completed",
      history: [],
      state: { iteration: 0, pending: null },
    };
    await store.save(rChat);
    await store.save(rPlanner);
    await store.save(rOtherSession);

    const runs = await loadRunsForSession(store, {
      sessionId: "sess-x",
      projectId: "p1",
      agentIds: ["chat", "planner"],
    });
    expect(runs.map((r) => r.runId).sort()).toEqual(["c1", "p1"]);
  });
});
