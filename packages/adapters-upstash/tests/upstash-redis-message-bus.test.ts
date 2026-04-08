import { describe, it, expect, vi, afterEach } from "vitest";
import { UpstashRedisMessageBus } from "../src/UpstashRedisMessageBus.js";

describe("UpstashRedisMessageBus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waitFor returns first XRANGE entry matching filter", async () => {
    const msgJson = JSON.stringify({
      id: "m1",
      fromAgentId: "a1",
      toAgentId: "a2",
      projectId: "p1",
      type: "event",
      payload: { x: 1 },
      meta: { ts: new Date().toISOString() },
    });

    const xrangeResult: unknown[] = [
      ["1730000000000-0", ["payload", msgJson]],
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as string[];
        if (body[0] === "XRANGE") {
          return new Response(JSON.stringify({ result: xrangeResult }));
        }
        return new Response(JSON.stringify({ result: null }));
      }),
    );

    const bus = new UpstashRedisMessageBus("https://redis.example", "t");
    const received = await bus.waitFor("a2", { fromAgentId: "a1" }, { timeoutMs: 2000 });

    expect(received.fromAgentId).toBe("a1");
    expect(received.toAgentId).toBe("a2");
    expect(received.payload).toEqual({ x: 1 });
  });

  it("send issues XADD and XTRIM", async () => {
    const calls: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as string[];
        calls.push(body);
        if (body[0] === "XADD") {
          return new Response(JSON.stringify({ result: "1730000000001-0" }));
        }
        if (body[0] === "XTRIM") {
          return new Response(JSON.stringify({ result: 0 }));
        }
        return new Response(JSON.stringify({ result: null }));
      }),
    );

    const bus = new UpstashRedisMessageBus("https://redis.example", "t");
    await bus.send({
      fromAgentId: "a1",
      toAgentId: "a2",
      projectId: "p1",
      type: "event",
      payload: { hello: true },
    });

    expect(calls.some((c) => c[0] === "XADD" && c.includes("payload"))).toBe(true);
    expect(calls.some((c) => c[0] === "XTRIM")).toBe(true);
  });
});
