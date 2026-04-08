import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { runCli } from "../src/index.ts";

describe("runCli", () => {
  it("init creates project", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cli-init-"));
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const code = await runCli(["init", "app"]);
      expect(code).toBe(0);
      const { access } = await import("node:fs/promises");
      await access(path.join(dir, "app", "package.json"));
    } finally {
      process.chdir(prev);
    }
  });

  it("generate agent uses cwd", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cli-gen-"));
    const root = path.join(dir, "proj");
    const { scaffold } = await import("@agent-runtime/scaffold");
    await scaffold.initProject({ name: "proj", path: root, template: "default" });

    const code = await runCli([
      "generate",
      "agent",
      "support-bot",
      "--cwd",
      root,
      "--tools",
      "save_memory",
    ]);
    expect(code).toBe(0);
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(path.join(root, "agents/support-bot.ts"), "utf8");
    expect(src).toContain("support-bot");
    expect(src).toContain("save_memory");
  });
});
