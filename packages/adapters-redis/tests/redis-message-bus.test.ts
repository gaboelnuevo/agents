import { describe, it, expect, vi } from "vitest";
import type Redis from "ioredis";
import { RedisMessageBus } from "../src/RedisMessageBus.js";

describe("RedisMessageBus", () => {
  it("send issues XADD and XTRIM", async () => {
    const xadd = vi.fn().mockResolvedValue("1730000000001-0");
    const xtrim = vi.fn().mockResolvedValue(0);
    const xrange = vi.fn().mockResolvedValue([]);
    const redis = { xadd, xtrim, xrange } as unknown as Redis;

    const bus = new RedisMessageBus(redis);
    await bus.send({
      fromAgentId: "a1",
      toAgentId: "a2",
      projectId: "p1",
      type: "event",
      payload: { hello: true },
    });

    expect(xadd).toHaveBeenCalled();
    const xaddArgs = xadd.mock.calls[0]!;
    expect(xaddArgs[0]).toBe("bus:agent:a2");
    expect(xaddArgs[1]).toBe("*");
    expect(xaddArgs[2]).toBe("payload");
    const parsed = JSON.parse(xaddArgs[3] as string) as { fromAgentId: string; payload: unknown };
    expect(parsed.fromAgentId).toBe("a1");
    expect(parsed.payload).toEqual({ hello: true });

    expect(xtrim).toHaveBeenCalledWith("bus:agent:a2", "MAXLEN", "~", 2000);
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

    const xrangeResult: [string, string[]][] = [["1730000000000-0", ["payload", msgJson]]];

    const xadd = vi.fn();
    const xtrim = vi.fn();
    const xrange = vi.fn().mockResolvedValue(xrangeResult);
    const redis = { xadd, xtrim, xrange } as unknown as Redis;

    const bus = new RedisMessageBus(redis);
    const received = await bus.waitFor("a2", { fromAgentId: "a1" }, { timeoutMs: 2000 });

    expect(received.fromAgentId).toBe("a1");
    expect(received.toAgentId).toBe("a2");
    expect(received.payload).toEqual({ x: 1 });
    expect(xrange).toHaveBeenCalledWith("bus:agent:a2", "-", "+");
  });
});
