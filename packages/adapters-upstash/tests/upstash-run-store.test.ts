import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpstashRunStore } from "../src/UpstashRunStore.js";
import type { Run } from "@opencoreagents/core";

describe("UpstashRunStore", () => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();

  beforeEach(() => {
    store.clear();
    sets.clear();
    zsets.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as string[];
        const cmd = body[0];

        if (cmd === "SET") {
          const [, key, value] = body;
          store.set(key as string, value as string);
          return new Response(JSON.stringify({ result: "OK" }));
        }
        if (cmd === "GET") {
          const key = body[1] as string;
          const v = store.get(key) ?? null;
          return new Response(JSON.stringify({ result: v }));
        }
        if (cmd === "DEL") {
          const key = body[1] as string;
          store.delete(key);
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === "SADD") {
          const [, setKey, member] = body;
          let s = sets.get(setKey as string);
          if (!s) {
            s = new Set();
            sets.set(setKey as string, s);
          }
          s.add(member as string);
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === "SREM") {
          const [, setKey, member] = body;
          sets.get(setKey as string)?.delete(member as string);
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === "ZADD") {
          const [, zsetKey, score, member] = body;
          let z = zsets.get(zsetKey as string);
          if (!z) {
            z = new Map();
            zsets.set(zsetKey as string, z);
          }
          z.set(member as string, Number(score));
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === "ZREM") {
          const [, zsetKey, member] = body;
          zsets.get(zsetKey as string)?.delete(member as string);
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === "ZRANGE" || cmd === "ZREVRANGE") {
          const [, zsetKey, startRaw, stopRaw] = body;
          const start = Number(startRaw);
          const stop = Number(stopRaw);
          const members = [...(zsets.get(zsetKey as string)?.entries() ?? [])]
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
            .map(([member]) => member);
          const ordered = cmd === "ZREVRANGE" ? members.reverse() : members;
          return new Response(JSON.stringify({ result: ordered.slice(start, stop + 1) }));
        }
        if (cmd === "SMEMBERS") {
          const setKey = body[1] as string;
          const members = [...(sets.get(setKey) ?? [])];
          return new Response(JSON.stringify({ result: members }));
        }
        if (cmd === "EVAL") {
          const key = body[3] as string;
          const expected = body[4] as string;
          const newJson = body[5] as string;
          const agentId = body[6] as string;
          const runId = body[7] as string;
          const raw = store.get(key);
          if (!raw) {
            return new Response(JSON.stringify({ result: 0 }));
          }
          const m = String(raw).match(/"status":"([^"]*)"/);
          if (!m || m[1] !== expected) {
            return new Response(JSON.stringify({ result: 0 }));
          }
          store.set(key, newJson);
          let s = sets.get(`run:agent:${agentId}`);
          if (!s) {
            s = new Set();
            sets.set(`run:agent:${agentId}`, s);
          }
          s.add(runId);
          const sessionId = body[8] as string;
          const score = Number(body[9]);
          if (sessionId) {
            const zkey = `run:agent-session:${agentId}:${sessionId}`;
            let z = zsets.get(zkey);
            if (!z) {
              z = new Map();
              zsets.set(zkey, z);
            }
            z.set(runId, score);
          }
          return new Response(JSON.stringify({ result: 1 }));
        }

        return new Response(JSON.stringify({ result: null }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("save, load, delete, listByAgent", async () => {
    const rs = new UpstashRunStore("https://redis.example", "token");
    const run: Run = {
      runId: "r1",
      agentId: "a1",
      sessionId: "s1",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null },
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

    const bySession = await rs.listByAgentAndSession("a1", "s1");
    expect(bySession.runs).toHaveLength(1);
    expect(bySession.runs[0]!.runId).toBe("r1");

    await rs.delete("r1");
    expect(await rs.load("r1")).toBeNull();
    expect(await rs.listByAgent("a1")).toHaveLength(0);
    expect((await rs.listByAgentAndSession("a1", "s1")).runs).toHaveLength(0);
  });

  it("saveIfStatus updates only when stored status matches", async () => {
    const rs = new UpstashRunStore("https://redis.example", "token");
    const waiting: Run = {
      runId: "r2",
      agentId: "a1",
      sessionId: "s1",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null },
    };
    await rs.save(waiting);
    const completed = { ...waiting, status: "completed" as const };
    expect(await rs.saveIfStatus(completed, "waiting")).toBe(true);
    expect((await rs.load("r2"))!.status).toBe("completed");
    expect(await rs.saveIfStatus({ ...waiting, status: "failed" }, "waiting")).toBe(
      false,
    );
  });

  it("paginates session-scoped runs in recency order", async () => {
    const rs = new UpstashRunStore("https://redis.example", "token");
    await rs.save({
      runId: "r-old",
      agentId: "a1",
      sessionId: "s1",
      status: "completed",
      history: [
        { type: "result", content: "old", meta: { ts: "2026-01-01T00:00:00.000Z", source: "engine" } },
      ],
      state: { iteration: 0, pending: null },
    });
    await rs.save({
      runId: "r-new",
      agentId: "a1",
      sessionId: "s1",
      status: "waiting",
      history: [
        { type: "result", content: "new", meta: { ts: "2026-01-02T00:00:00.000Z", source: "engine" } },
      ],
      state: { iteration: 0, pending: null },
    });

    const firstPage = await rs.listByAgentAndSession("a1", "s1", { limit: 1 });
    expect(firstPage.runs.map((run) => run.runId)).toEqual(["r-new"]);
    expect(firstPage.nextCursor).toBe("1");

    const secondPage = await rs.listByAgentAndSession("a1", "s1", {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.runs.map((run) => run.runId)).toEqual(["r-old"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});
