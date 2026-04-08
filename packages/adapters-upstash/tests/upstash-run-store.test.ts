import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpstashRunStore } from "../src/UpstashRunStore.js";
import type { Run } from "@agent-runtime/core";

describe("UpstashRunStore", () => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  beforeEach(() => {
    store.clear();
    sets.clear();
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

    await rs.delete("r1");
    expect(await rs.load("r1")).toBeNull();
    expect(await rs.listByAgent("a1")).toHaveLength(0);
  });

  it("saveIfStatus updates only when stored status matches", async () => {
    const rs = new UpstashRunStore("https://redis.example", "token");
    const waiting: Run = {
      runId: "r2",
      agentId: "a1",
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
});
