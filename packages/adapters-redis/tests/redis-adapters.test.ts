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

  it("saveIfStatus succeeds only when Redis row still has expected status", async () => {
    const rs = new RedisRunStore(redis);
    const waiting: Run = {
      runId: "r-cas",
      agentId: "a1",
      sessionId: "s1",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "" },
    };
    await rs.save(waiting);
    const completed = { ...waiting, status: "completed" as const };
    expect(await rs.saveIfStatus(completed, "waiting")).toBe(true);
    expect((await rs.load("r-cas"))!.status).toBe("completed");
    expect(await rs.saveIfStatus({ ...waiting, status: "failed" }, "waiting")).toBe(
      false,
    );
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

  it("concurrent save does not drop entries (LIST + RPUSH)", async () => {
    const mem = new RedisMemoryAdapter(redis);
    const scope = { projectId: "p1", agentId: "a1", sessionId: "s-conc" };
    const n = 80;
    await Promise.all(
      Array.from({ length: n }, (_, i) => mem.save(scope, "working", { i })),
    );
    const rows = (await mem.query(scope, "working")) as { i: number }[];
    expect(rows).toHaveLength(n);
    const is = rows.map((r) => r.i).sort((a, b) => a - b);
    expect(is).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("migrates legacy STRING JSON array to LIST on first save", async () => {
    const mem = new RedisMemoryAdapter(redis);
    const scope = { projectId: "p1", agentId: "a1", sessionId: "s-mig" };
    const key = `${memoryKeyPrefix(scope)}:working`;
    await redis.set(key, JSON.stringify([{ legacy: true }]));
    await mem.save(scope, "working", { next: true });
    const rows = await mem.query(scope, "working");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ legacy: true });
    expect(rows[1]).toEqual({ next: true });
    expect(await redis.type(key)).toBe("list");
  });
});
