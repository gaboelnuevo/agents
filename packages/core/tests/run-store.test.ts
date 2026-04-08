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
});
