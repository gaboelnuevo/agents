import { describe, it, expect } from "vitest";
import { ToolRunner } from "../src/tools/ToolRunner.js";
import type { ToolAdapter, ToolContext } from "../src/adapters/tool/ToolAdapter.js";
import { ToolTimeoutError, ToolValidationError } from "../src/errors/index.js";
import { InMemoryMemoryAdapter } from "../src/adapters/memory/InMemoryMemoryAdapter.js";

const ctxBase = (): ToolContext => ({
  projectId: "p1",
  agentId: "a1",
  runId: "r1",
  sessionId: "s1",
  memoryAdapter: new InMemoryMemoryAdapter(),
  securityContext: {
    principalId: "internal",
    kind: "internal",
    organizationId: "p1",
    projectId: "p1",
    roles: ["agent"],
    scopes: ["*"],
  },
});

describe("ToolRunner", () => {
  it("completes fast tools without timeout option", async () => {
    const tool: ToolAdapter = {
      name: "ok",
      async execute() {
        return { x: 1 };
      },
    };
    const runner = new ToolRunner(new Map([["ok", tool]]), new Set(["ok"]));
    const out = await runner.execute("ok", {}, ctxBase());
    expect(out).toEqual({ x: 1 });
  });

  it("rejects when tool exceeds toolTimeoutMs", async () => {
    const tool: ToolAdapter = {
      name: "slow",
      async execute() {
        await new Promise((r) => setTimeout(r, 200));
        return { ok: true };
      },
    };
    const runner = new ToolRunner(new Map([["slow", tool]]), new Set(["slow"]), {
      toolTimeoutMs: 30,
    });
    await expect(runner.execute("slow", {}, ctxBase())).rejects.toThrow(ToolTimeoutError);
  });

  it("includes validation reason when a tool returns structured validation failure", async () => {
    const tool: ToolAdapter = {
      name: "mem",
      validate() {
        return { ok: false, reason: "memoryType must be one of shortTerm, longTerm, working" };
      },
      async execute() {
        return { ok: true };
      },
    };
    const runner = new ToolRunner(new Map([["mem", tool]]), new Set(["mem"]));
    await expect(runner.execute("mem", {}, ctxBase())).rejects.toThrow(
      /memoryType must be one of shortTerm, longTerm, working/,
    );
    await expect(runner.execute("mem", {}, ctxBase())).rejects.toBeInstanceOf(ToolValidationError);
  });
});
