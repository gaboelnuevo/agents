import { describe, it, expect } from "vitest";
import { InMemoryRunStore } from "../src/adapters/run/InMemoryRunStore.js";
import type { Run } from "../src/protocol/types.js";

const baseRun = (over: Partial<Run> = {}): Run => ({
  runId: "r1",
  agentId: "a1",
  sessionId: "s1",
  status: "waiting",
  history: [],
  state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "" },
  ...over,
});

describe("InMemoryRunStore saveIfStatus", () => {
  it("writes only when stored status matches", async () => {
    const store = new InMemoryRunStore();
    await store.save(baseRun());
    const next = baseRun({ status: "completed" });
    expect(await store.saveIfStatus(next, "waiting")).toBe(true);
    expect((await store.load("r1"))!.status).toBe("completed");
    expect(await store.saveIfStatus(baseRun({ status: "failed" }), "waiting")).toBe(
      false,
    );
    expect((await store.load("r1"))!.status).toBe("completed");
  });

  it("lists runs by agent and session with recency ordering and pagination", async () => {
    const store = new InMemoryRunStore();
    await store.save(
      baseRun({
        runId: "r-old",
        status: "completed",
        history: [{ type: "result", content: "old", meta: { ts: "2026-01-01T00:00:00.000Z", source: "engine" } }],
      }),
    );
    await store.save(
      baseRun({
        runId: "r-new",
        status: "waiting",
        history: [{ type: "result", content: "new", meta: { ts: "2026-01-02T00:00:00.000Z", source: "engine" } }],
      }),
    );
    await store.save(
      baseRun({
        runId: "r-other-session",
        sessionId: "s2",
        history: [{ type: "result", content: "skip", meta: { ts: "2026-01-03T00:00:00.000Z", source: "engine" } }],
      }),
    );

    const firstPage = await store.listByAgentAndSession("a1", "s1", { limit: 1 });
    expect(firstPage.runs.map((run) => run.runId)).toEqual(["r-new"]);
    expect(firstPage.nextCursor).toBe("1");

    const secondPage = await store.listByAgentAndSession("a1", "s1", {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.runs.map((run) => run.runId)).toEqual(["r-old"]);
    expect(secondPage.nextCursor).toBeUndefined();

    const waitingOnly = await store.listByAgentAndSession("a1", "s1", {
      status: "waiting",
      order: "asc",
    });
    expect(waitingOnly.runs.map((run) => run.runId)).toEqual(["r-new"]);
  });
});
