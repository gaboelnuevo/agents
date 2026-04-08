import { describe, it, expect, beforeEach } from "vitest";
import Redis from "ioredis-mock";
import type { Run } from "@agent-runtime/core";
import { RedisMemoryAdapter, RedisRunStore, memoryKeyPrefix } from "../src/index.js";

describe("RedisRunStore", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  it("save, load, delete, listByAgent", async () => {
    const rs = new RedisRunStore(redis);
    const run: Run = {
      runId: "r1",
      agentId: "a1",
      sessionId: "s1",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "" },
    };
    await rs.save(run);
    const loaded = await rs.load("r1");
    expect(loaded?.runId).toBe("r1");
    expect(loaded?.status).toBe("waiting");

    const listed = await rs.listByAgent("a1");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.runId).toBe("r1");

    const runningOnly = await rs.listByAgent("a1", "running");
    expect(runningOnly).toHaveLength(0);

    await rs.delete("r1");
    expect(await rs.load("r1")).toBeNull();
    expect(await rs.listByAgent("a1")).toHaveLength(0);
  });
});

describe("RedisMemoryAdapter", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  it("save, query, delete, getState", async () => {
    const mem = new RedisMemoryAdapter(redis);
    const scope = { projectId: "p1", agentId: "a1", sessionId: "s1" };
    expect(memoryKeyPrefix(scope)).toContain("m:p1:a1:s1");

    await mem.save(scope, "working", { note: 1 });
    await mem.save(scope, "working", { note: 2 });
    const rows = await mem.query(scope, "working");
    expect(rows).toHaveLength(2);

    await mem.delete(scope, "working");
    expect(await mem.query(scope, "working")).toHaveLength(0);

    expect(await mem.getState(scope)).toEqual({});
  });
});
