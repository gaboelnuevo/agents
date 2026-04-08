import path from "node:path";
import type {
  GenerateAgentOptions,
  GenerateSkillOptions,
  GenerateToolOptions,
  ScaffoldManifest,
} from "./types.js";
import { writeTextFile } from "./fs-utils.js";
import { normalizeToolId, toSkillIdCamel } from "./strings.js";

function safeAgentFileName(agentId: string): string {
  const s = agentId.trim().replace(/[^a-zA-Z0-9-_]/g, "-");
  return s || "agent";
}

function toolFileBase(toolId: string): string {
  return normalizeToolId(toolId).replace(/_/g, "-");
}

export async function generateAgent(
  opts: GenerateAgentOptions,
): Promise<ScaffoldManifest> {
  const projectPath = path.resolve(opts.projectPath);
  const agentId = opts.agentId.trim();
  if (!agentId) throw new Error("generateAgent: `agentId` is required.");

  const skills = opts.skills ?? [];
  const tools = opts.tools ?? ["save_memory", "get_memory"];
  const withTest = opts.withTest ?? true;
  const model = opts.llmModel?.trim() || "gpt-4o";
  const force = opts.force ?? false;

  const fileBase = safeAgentFileName(agentId);
  const rel = `agents/${fileBase}.ts`;
  const skillsJson = JSON.stringify(skills);
  const toolsJson = JSON.stringify(tools);

  const contents = `import { Agent, Session, type AgentRuntime, type SessionOptions } from "@agent-runtime/core";

const SYSTEM = "You are ${agentId}. Each model turn must be a single JSON Step object.";

export async function register${toPascal(fileBase)}(): Promise<void> {
  await Agent.define({
    id: ${JSON.stringify(agentId)},
    name: ${JSON.stringify(agentId)},
    systemPrompt: SYSTEM,
    skills: ${skillsJson},
    tools: ${toolsJson},
    llm: { provider: "openai", model: ${JSON.stringify(model)}, temperature: 0.2 },
    security: { roles: ["agent"] },
  });
}

export async function load${toPascal(fileBase)}(runtime: AgentRuntime, sessionOpts: SessionOptions) {
  const session = new Session(sessionOpts);
  return Agent.load(${JSON.stringify(agentId)}, runtime, { session });
}
`;

  const created: string[] = [];
  const skipped: string[] = [];

  const a = await writeTextFile(projectPath, rel, contents, { force });
  if (a === "created") created.push(rel);
  else skipped.push(rel);

  if (withTest) {
    const testRel = `tests/${fileBase}.test.ts`;
    const testContents = `import { describe, it, expect } from "vitest";

describe(${JSON.stringify(agentId)}, () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
`;
    const b = await writeTextFile(projectPath, testRel, testContents, { force });
    if (b === "created") created.push(testRel);
    else skipped.push(testRel);
  }

  return { created, skipped };
}

function toPascal(slug: string): string {
  const words = slug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export async function generateTool(
  opts: GenerateToolOptions,
): Promise<ScaffoldManifest> {
  const projectPath = path.resolve(opts.projectPath);
  const id = normalizeToolId(opts.toolId);
  if (!id) throw new Error("generateTool: `toolId` is required.");

  const force = opts.force ?? false;
  const base = toolFileBase(opts.toolId);
  const rel = `tools/${base}.ts`;

  const contents = `import { Tool } from "@agent-runtime/core";

export async function register${toPascal(base)}Tool(): Promise<void> {
  await Tool.define({
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(id)},
    scope: "global",
    description: "TODO: describe what this tool does.",
    inputSchema: {
      type: "object",
      properties: {
        payload: { type: "object" },
      },
      required: ["payload"],
    },
    roles: ["agent"],
  });
}

export async function handle${toPascal(base)}(_input: unknown): Promise<unknown> {
  return { ok: true };
}
`;

  const created: string[] = [];
  const skipped: string[] = [];
  const st = await writeTextFile(projectPath, rel, contents, { force });
  if (st === "created") created.push(rel);
  else skipped.push(rel);
  return { created, skipped };
}

export async function generateSkill(
  opts: GenerateSkillOptions,
): Promise<ScaffoldManifest> {
  const projectPath = path.resolve(opts.projectPath);
  const skillCamel = toSkillIdCamel(opts.skillId);
  if (!skillCamel) throw new Error("generateSkill: `skillId` is required.");

  const tools = opts.tools ?? [];
  const force = opts.force ?? false;
  const rel = `skills/${skillCamel}.ts`;
  const toolsJson = JSON.stringify(tools);

  const contents = `import { Skill } from "@agent-runtime/core";

export async function register${toPascal(skillCamel)}Skill(): Promise<void> {
  await Skill.define({
    id: ${JSON.stringify(skillCamel)},
    name: ${JSON.stringify(skillCamel)},
    scope: "global",
    tools: ${toolsJson},
    description: "TODO: describe this skill.",
    roles: ["agent"],
  });
}
`;

  const created: string[] = [];
  const skipped: string[] = [];
  const st = await writeTextFile(projectPath, rel, contents, { force });
  if (st === "created") created.push(rel);
  else skipped.push(rel);
  return { created, skipped };
}
