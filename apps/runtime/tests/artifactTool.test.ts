import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllRegistriesForTests,
  InMemoryMemoryAdapter,
  resolveToolRegistry,
  type ToolContext,
} from "@opencoreagents/core";
import {
  registerRuntimeArtifactTool,
  RUNTIME_WRITE_ARTIFACT_TOOL_ID,
} from "../src/runtime/artifactTool.js";

const securityContext = {
  principalId: "test",
  kind: "internal" as const,
  organizationId: "org",
  projectId: "p1",
  roles: [] as string[],
  scopes: [] as string[],
};

function baseToolContext(): ToolContext {
  return {
    projectId: "p1",
    agentId: "planner",
    runId: "r1",
    sessionId: "s1",
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext,
  };
}

describe("registerRuntimeArtifactTool", () => {
  let rootDir = "";

  beforeEach(async () => {
    clearAllRegistriesForTests();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-artifacts-"));
  });

  afterEach(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes json artifacts inside the configured root", async () => {
    await registerRuntimeArtifactTool({
      enabled: true,
      rootDir,
      publicBaseUrl: "/artifacts",
    });
    const tool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
    const out = (await tool.execute(
      {
        path: "plans/birthday.json",
        format: "json",
        content: { ok: true, items: [1, 2] },
      },
      baseToolContext(),
    )) as {
      success: boolean;
      projectId: string;
      path: string;
      scopedPath: string;
      absolutePath: string;
      publicUrl: string;
    };

    expect(out.success).toBe(true);
    expect(out.projectId).toBe("p1");
    expect(out.path).toBe("plans/birthday.json");
    expect(out.scopedPath).toBe("p1/plans/birthday.json");
    expect(out.publicUrl).toBe("/artifacts/p1/plans/birthday.json");
    const body = await fs.readFile(out.absolutePath, "utf8");
    expect(body).toContain('"ok": true');
    expect(out.absolutePath).toContain(path.join("p1", "plans", "birthday.json"));
  });

  it("rejects path traversal outside the artifact root", async () => {
    await registerRuntimeArtifactTool({
      enabled: true,
      rootDir,
    });
    const tool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
    await expect(
      tool.execute(
        {
          path: "../escape.txt",
          content: "nope",
        },
        baseToolContext(),
      ),
    ).rejects.toThrow(/artifact root/);
  });
});
