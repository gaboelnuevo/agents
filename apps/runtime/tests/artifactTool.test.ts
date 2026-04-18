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
  registerRuntimeArtifactTools,
  RUNTIME_WRITE_ARTIFACT_TOOL_ID,
  RUNTIME_LIST_ARTIFACTS_TOOL_ID,
} from "../src/runtime/artifactTool.js";

const securityContext = {
  principalId: "test",
  kind: "internal" as const,
  organizationId: "org",
  projectId: "p1",
  roles: [] as string[],
  scopes: [] as string[],
};

function baseToolContext(sessionId = "s1", parentSessionId?: string): ToolContext {
  return {
    projectId: "p1",
    agentId: "planner",
    runId: "r1",
    sessionId,
    sessionContext: parentSessionId ? { invokedBySessionId: parentSessionId } : undefined,
    memoryAdapter: new InMemoryMemoryAdapter(),
    securityContext,
  };
}

describe("registerRuntimeArtifactTools", () => {
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

  describe("system_write_artifact", () => {
    it("writes json artifacts inside the configured root scoped by projectId and sessionId", async () => {
      await registerRuntimeArtifactTools({
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
        sessionId: string;
        path: string;
        scopedPath: string;
        absolutePath: string;
        publicUrl: string;
      };

      expect(out.success).toBe(true);
      expect(out.projectId).toBe("p1");
      expect(out.sessionId).toBe("s1");
      expect(out.path).toBe("plans/birthday.json");
      expect(out.scopedPath).toBe("p1/s1/plans/birthday.json");
      expect(out.publicUrl).toBe("/artifacts/p1/s1/plans/birthday.json");
      const body = await fs.readFile(out.absolutePath, "utf8");
      expect(body).toContain('"ok": true');
      expect(out.absolutePath).toContain(path.join("p1", "s1", "plans", "birthday.json"));
    });

    it("uses parent session ID when session has invokedBySessionId (planner sub-agents)", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
        publicBaseUrl: "/artifacts",
      });
      const tool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
      
      // Child session writing artifact
      const out = (await tool.execute(
        {
          path: "report.md",
          content: "# Report from sub-agent",
        },
        baseToolContext("child-session", "parent-session"),
      )) as {
        success: boolean;
        sessionId: string;
        scopedPath: string;
      };

      // Should use parent session ID, not child session ID
      expect(out.success).toBe(true);
      expect(out.sessionId).toBe("parent-session");
      expect(out.scopedPath).toBe("p1/parent-session/report.md");
    });

    it("rejects path traversal outside the artifact root", async () => {
      await registerRuntimeArtifactTools({
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

  describe("system_list_artifacts", () => {
    it("lists all artifacts for a session", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
        publicBaseUrl: "/artifacts",
      });
      const writeTool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
      const listTool = resolveToolRegistry("p1").get(RUNTIME_LIST_ARTIFACTS_TOOL_ID)!;

      // Write a couple of artifacts
      await writeTool.execute(
        { path: "report1.md", content: "# Report 1" },
        baseToolContext("session-a"),
      );
      await writeTool.execute(
        { path: "subfolder/report2.json", format: "json", content: { data: true } },
        baseToolContext("session-a"),
      );
      // Write to different session - should not appear in list
      await writeTool.execute(
        { path: "other.md", content: "Other" },
        baseToolContext("session-b"),
      );

      const out = (await listTool.execute({}, baseToolContext("session-a"))) as {
        success: boolean;
        projectId: string;
        sessionId: string;
        count: number;
        artifacts: Array<{
          path: string;
          scopedPath: string;
          publicUrl?: string;
          size: number;
        }>;
      };

      expect(out.success).toBe(true);
      expect(out.projectId).toBe("p1");
      expect(out.sessionId).toBe("session-a");
      expect(out.count).toBe(2);
      expect(out.artifacts.map((a) => a.path).sort()).toEqual(["report1.md", "subfolder/report2.json"]);
      
      // Check scoped paths include session
      const report1 = out.artifacts.find((a) => a.path === "report1.md")!;
      expect(report1.scopedPath).toBe("p1/session-a/report1.md");
      expect(report1.publicUrl).toBe("/artifacts/p1/session-a/report1.md");
      expect(report1.size).toBeGreaterThan(0);
    });

    it("lists artifacts from parent session when child session has invokedBySessionId", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
      });
      const writeTool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
      const listTool = resolveToolRegistry("p1").get(RUNTIME_LIST_ARTIFACTS_TOOL_ID)!;

      // Write artifact to parent session
      await writeTool.execute(
        { path: "parent-report.md", content: "# Parent" },
        baseToolContext("parent-session"),
      );

      // List from child session - should see parent's artifacts
      const out = (await listTool.execute(
        {},
        baseToolContext("child-session", "parent-session"),
      )) as {
        success: boolean;
        sessionId: string;
        count: number;
        artifacts: Array<{ path: string }>;
      };

      expect(out.success).toBe(true);
      expect(out.sessionId).toBe("parent-session");
      expect(out.count).toBe(1);
      expect(out.artifacts[0].path).toBe("parent-report.md");
    });

    it("filters by prefix when provided", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
      });
      const writeTool = resolveToolRegistry("p1").get(RUNTIME_WRITE_ARTIFACT_TOOL_ID)!;
      const listTool = resolveToolRegistry("p1").get(RUNTIME_LIST_ARTIFACTS_TOOL_ID)!;

      await writeTool.execute(
        { path: "root.md", content: "Root" },
        baseToolContext(),
      );
      await writeTool.execute(
        { path: "sub/nested.md", content: "Nested" },
        baseToolContext(),
      );

      const out = (await listTool.execute({ prefix: "sub" }, baseToolContext())) as {
        success: boolean;
        count: number;
        artifacts: Array<{ path: string }>;
      };

      expect(out.success).toBe(true);
      expect(out.count).toBe(1);
      // Path is relative to the session root, so includes the prefix
      expect(out.artifacts[0].path).toBe("sub/nested.md");
    });

    it("returns empty list for session with no artifacts", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
      });
      const listTool = resolveToolRegistry("p1").get(RUNTIME_LIST_ARTIFACTS_TOOL_ID)!;

      const out = (await listTool.execute({}, baseToolContext("empty-session"))) as {
        success: boolean;
        count: number;
        artifacts: unknown[];
      };

      expect(out.success).toBe(true);
      expect(out.count).toBe(0);
      expect(out.artifacts).toEqual([]);
    });

    it("rejects prefix traversal outside the artifact root", async () => {
      await registerRuntimeArtifactTools({
        enabled: true,
        rootDir,
      });
      const listTool = resolveToolRegistry("p1").get(RUNTIME_LIST_ARTIFACTS_TOOL_ID)!;
      
      await expect(
        listTool.execute({ prefix: "../escape" }, baseToolContext()),
      ).rejects.toThrow(/artifact root/);
    });
  });
});
