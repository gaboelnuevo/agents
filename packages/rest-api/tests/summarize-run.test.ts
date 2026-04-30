import { describe, expect, it } from "vitest";
import type { Run } from "@opencoreagents/core";
import { summarizeEngineRun } from "../src/summarizeRun.js";

describe("summarizeEngineRun", () => {
  it("uses the last result step in history (continueRun appends a new turn)", () => {
    const run = {
      runId: "r1",
      agentId: "a",
      status: "completed",
      history: [
        { type: "thought", content: "t1", meta: { ts: "1", source: "llm" as const } },
        { type: "result", content: "first answer", meta: { ts: "2", source: "llm" as const } },
        { type: "thought", content: "t2", meta: { ts: "3", source: "llm" as const } },
        { type: "result", content: "second answer", meta: { ts: "4", source: "llm" as const } },
      ],
      state: { iteration: 1, pending: null },
    } as Run;

    const s = summarizeEngineRun(run);
    expect(s.reply).toBe("second answer");
    expect(s.runId).toBe("r1");
    expect(s.status).toBe("completed");
    expect(s.failedReason).toBeUndefined();
  });

  it("includes failedReason from state when failed", () => {
    const run = {
      runId: "r2",
      agentId: "a",
      status: "failed",
      history: [{ type: "result", content: "partial", meta: { ts: "1", source: "llm" as const } }],
      state: { iteration: 0, pending: null, failedReason: "  boom  " },
    } as Run;

    const s = summarizeEngineRun(run);
    expect(s.status).toBe("failed");
    expect(s.reply).toBe("partial");
    expect(s.failedReason).toBe("boom");
  });

  it("extracts reply + short_answers from JSON result envelope", () => {
    const run = {
      runId: "r-json",
      agentId: "a",
      status: "completed",
      history: [
        {
          type: "result",
          content: JSON.stringify({
            reply: "Sure, I can help with that.",
            short_answers: ["Yes", "No", "Tell me more"],
          }),
          meta: { ts: "1", source: "llm" as const },
        },
      ],
      state: { iteration: 0, pending: null },
    } as Run;

    const s = summarizeEngineRun(run);
    expect(s.reply).toBe("Sure, I can help with that.");
    expect(s.short_answers).toEqual(["Yes", "No", "Tell me more"]);
  });

  it("reply undefined when no result step", () => {
    const run = {
      runId: "r3",
      agentId: "a",
      status: "running",
      history: [{ type: "thought", content: "t", meta: { ts: "1", source: "llm" as const } }],
      state: { iteration: 0, pending: null },
    } as Run;

    const s = summarizeEngineRun(run);
    expect(s.reply).toBeUndefined();
    expect(s.failedReason).toBeUndefined();
  });
});
