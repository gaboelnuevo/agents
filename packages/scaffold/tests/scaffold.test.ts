import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { scaffold } from "../src/index.ts";

describe("scaffold", () => {
  it("initProject writes default template", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "my-project");
    const m = await scaffold.initProject({
      name: "my-project",
      path: root,
      template: "default",
    });
    expect(m.created).toContain("package.json");
    expect(m.created).toContain("agents/example-agent.ts");
    await access(path.join(root, "config/runtime.ts"));
  });

  it("initProject skips existing files without force", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "p");
    await scaffold.initProject({ name: "p", path: root, template: "minimal" });
    const m2 = await scaffold.initProject({ name: "p", path: root, template: "minimal" });
    expect(m2.skipped.length).toBeGreaterThan(0);
    expect(m2.created.length).toBe(0);
  });

  it("generateAgent respects llmModel", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "proj");
    await scaffold.initProject({ name: "proj", path: root, template: "default" });
    await scaffold.generateAgent({
      projectPath: root,
      agentId: "a1",
      llmModel: "gpt-4.1-mini",
    });
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(path.join(root, "agents/a1.ts"), "utf8");
    expect(src).toContain("gpt-4.1-mini");
  });

  it("generateAgent adds agent file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "proj");
    await scaffold.initProject({ name: "proj", path: root, template: "default" });
    const m = await scaffold.generateAgent({
      projectPath: root,
      agentId: "support-bot",
      skills: [],
      tools: ["save_memory"],
    });
    expect(m.created).toContain("agents/support-bot.ts");
  });

  it("generateTool normalizes id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "proj");
    await scaffold.initProject({ name: "proj", path: root, template: "default" });
    const m = await scaffold.generateTool({
      projectPath: root,
      toolId: "send-email",
    });
    expect(m.created).toContain("tools/send-email.ts");
  });

  it("generateSkill camelCases id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scaffold-"));
    const root = path.join(dir, "proj");
    await scaffold.initProject({ name: "proj", path: root, template: "default" });
    const m = await scaffold.generateSkill({
      projectPath: root,
      skillId: "intake-summary",
      tools: ["save_memory"],
    });
    expect(m.created).toContain("skills/intakeSummary.ts");
  });
});
