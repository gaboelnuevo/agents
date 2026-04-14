import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  skillDocsDirectory,
  skillIds,
  skillPackagesDirectory,
  skillsDirectory,
} from "../src/index.js";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(pkgRoot, "dist");

describe("code-skills pack", () => {
  it("exposes a skills directory with each SKILL.md", () => {
    expect(existsSync(skillsDirectory)).toBe(true);
    for (const id of skillIds) {
      const md = join(skillsDirectory, id, "SKILL.md");
      expect(existsSync(md), md).toBe(true);
    }
  });

  it("after build, each skill has docs/ and expected bundle files", () => {
    expect(existsSync(join(distRoot, "index.js"))).toBe(true);

    const workspaceDocs = skillDocsDirectory("opencoreagents-workspace");
    expect(existsSync(join(workspaceDocs, "core", "README.md"))).toBe(true);
    expect(existsSync(join(workspaceDocs, "planning", "plan.md"))).toBe(true);
    expect(existsSync(join(skillPackagesDirectory("opencoreagents-workspace"), "rest-api", "README.md"))).toBe(
      true,
    );

    const engineDocs = skillDocsDirectory("opencoreagents-engine");
    expect(existsSync(join(engineDocs, "core", "03-execution-model.md"))).toBe(true);
    expect(existsSync(join(engineDocs, "core", "10-llm-adapter.md"))).toBe(true);
    expect(existsSync(join(engineDocs, "core", "08-scope-and-security.md"))).toBe(true);
    expect(existsSync(join(engineDocs, "planning", "mvp.md"))).toBe(true);

    const workspacePlanning = join(skillDocsDirectory("opencoreagents-workspace"), "planning");
    expect(existsSync(join(workspacePlanning, "plan.md"))).toBe(true);
    expect(existsSync(join(workspacePlanning, "technical-debt.md"))).toBe(false);

    const restDocs = skillDocsDirectory("opencoreagents-rest-workers");
    expect(existsSync(join(restDocs, "core", "15-multi-tenancy.md"))).toBe(true);
    expect(existsSync(join(restDocs, "core", "21-dynamic-runtime-rest.md"))).toBe(true);
    expect(existsSync(join(skillPackagesDirectory("opencoreagents-rest-workers"), "rest-api", "README.md"))).toBe(
      true,
    );

    const ragDocs = skillDocsDirectory("opencoreagents-rag-dynamic");
    expect(existsSync(join(ragDocs, "core", "17-rag-pipeline.md"))).toBe(true);
    expect(existsSync(join(skillPackagesDirectory("opencoreagents-rag-dynamic"), "rag", "README.md"))).toBe(true);
  });

  it("does not use a single top-level dist/docs or dist/packages tree", () => {
    expect(existsSync(join(distRoot, "docs"))).toBe(false);
    expect(existsSync(join(distRoot, "packages"))).toBe(false);
  });
});
