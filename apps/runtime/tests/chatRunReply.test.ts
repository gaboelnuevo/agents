/**
 * Regression: after **`invoke_planner`** + **`continue`**, **`POST /v1/chat`** with **`wait`** could repeat the
 * **previous** `result` when {@link RunStore} still held a shorter `history` than the job `returnvalue`
 * (store lag vs worker snapshot).
 */
import type { Run, RunStore } from "@opencoreagents/core";
import { describe, expect, it, vi } from "vitest";
import { resolveRunForChatReply } from "../src/http/chatRunReply.js";

function baseRun(over: Partial<Run> & Pick<Run, "runId" | "status">): Run {
  return {
    agentId: "chat",
    sessionId: "s1",
    projectId: "p1",
    history: [],
    state: { iteration: 0, pending: null, userInput: "hi" },
    ...over,
  };
}

describe("resolveRunForChatReply", () => {
  it("returns candidate when store has no row", async () => {
    const candidate = baseRun({
      runId: "r1",
      status: "completed",
      history: [{ type: "result", content: "new", meta: { ts: "t", source: "llm" } }],
    });
    const store = {
      load: vi.fn().mockResolvedValue(null),
    } as unknown as RunStore;

    const out = await resolveRunForChatReply(store, candidate);
    expect(out).toEqual(candidate);
  });

  it("returns persisted when it has same or longer history (authoritative store)", async () => {
    const persisted = baseRun({
      runId: "r1",
      status: "completed",
      history: [
        { type: "thought", content: "t", meta: { ts: "1", source: "llm" } },
        { type: "result", content: "from-redis", meta: { ts: "2", source: "llm" } },
      ],
    });
    const candidate = baseRun({
      runId: "r1",
      status: "completed",
      history: [{ type: "result", content: "short-job", meta: { ts: "x", source: "llm" } }],
    });
    const store = { load: vi.fn().mockResolvedValue(persisted) } as unknown as RunStore;

    const out = await resolveRunForChatReply(store, candidate);
    expect(out?.history.length).toBe(2);
    expect((out?.history[out.history.length - 1] as { content?: string }).content).toBe("from-redis");
  });

  it("returns candidate when persisted history is shorter (stale store after continue)", async () => {
    const persisted = baseRun({
      runId: "r1",
      status: "completed",
      history: [
        { type: "action", content: { tool: "invoke_planner", input: {} }, meta: { ts: "1", source: "llm" } },
        { type: "observation", content: { jobId: "j" }, meta: { ts: "2", source: "tool" } },
        { type: "result", content: "Planner queued.", meta: { ts: "3", source: "llm" } },
      ],
    });
    const candidate = baseRun({
      runId: "r1",
      status: "completed",
      history: [
        ...persisted.history,
        { type: "thought", content: "u", meta: { ts: "4", source: "llm" } },
        {
          type: "result",
          content: "Answer for the NEW user question.",
          meta: { ts: "5", source: "llm" },
        },
      ],
    });
    const store = { load: vi.fn().mockResolvedValue(persisted) } as unknown as RunStore;

    const out = await resolveRunForChatReply(store, candidate);
    const last = out?.history[out!.history.length - 1];
    expect(last?.type).toBe("result");
    expect((last as { content?: string }).content).toBe("Answer for the NEW user question.");
  });
});
