import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { skillIds, skillsDirectory } from "./index.js";

type SkillId = (typeof skillIds)[number];

function isValidSkillId(id: string): id is SkillId {
  return skillIds.includes(id as SkillId);
}

function getDefaultSkillsDir(): string {
  return join(process.cwd(), ".skills");
}

async function copySkill(
  srcDir: string,
  destDir: string,
  options: { force?: boolean } = {}
): Promise<void> {
  // Verify SKILL.md exists
  const skillMdPath = join(srcDir, "SKILL.md");
  try {
    await fs.access(skillMdPath);
  } catch {
    throw new Error(`SKILL.md not found in ${srcDir}`);
  }

  // Create parent directory
  await fs.mkdir(dirname(destDir), { recursive: true });

  // Check if destination exists
  try {
    await fs.access(destDir);
    if (!options.force) {
      throw new Error(
        `Skill already installed at ${destDir}. Use --force to overwrite.`
      );
    }
    await fs.rm(destDir, { recursive: true, force: true });
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== "ENOENT") {
      throw err;
    }
  }

  // Copy directory recursively
  await fs.cp(srcDir, destDir, { recursive: true });
}

async function installSkill(
  skillId: SkillId,
  options: { force?: boolean; skillsDir?: string } = {}
): Promise<{ skillId: string; installedPath: string }> {
  const skillsDir = options.skillsDir ?? getDefaultSkillsDir();
  const destDir = join(skillsDir, skillId);
  const skillSrcDir = join(skillsDirectory, skillId);

  await copySkill(skillSrcDir, destDir, options);
  return { skillId, installedPath: destDir };
}

function printHelp(): void {
  console.log(`opencoreagents-skills — install OpenCore Agents skills in your project

Usage:
  npx @opencoreagents/code-skills add <skill-id>
  npx @opencoreagents/code-skills list

Commands:
  add   Install a skill by ID
  list  List available skills

Options:
  --force    Overwrite existing skill
  --dir      Skills directory (default: ./.skills)

Available skills:
  opencoreagents-workspace
  opencoreagents-engine
  opencoreagents-rest-workers
  opencoreagents-rag-dynamic

Examples:
  npx @opencoreagents/code-skills add opencoreagents-engine
  npx @opencoreagents/code-skills add opencoreagents-engine --force
  npx @opencoreagents/code-skills add opencoreagents-engine --dir .claude/skills
`);
}

async function listSkills(options: { skillsDir?: string } = {}): Promise<void> {
  const skillsDir = options.skillsDir ?? getDefaultSkillsDir();
  console.log("Available OpenCore Agents skills:\n");
  for (const id of skillIds) {
    const installedPath = join(skillsDir, id);
    let status = "";
    try {
      await fs.access(installedPath);
      status = " (already installed)";
    } catch {
      status = "";
    }
    console.log(`  ${id}${status}`);
  }
  console.log("\nInstall with: npx @opencoreagents/code-skills add <skill-id>");
}

async function addSkill(
  skillId: string,
  options: { force?: boolean; skillsDir?: string } = {}
): Promise<number> {
  if (!isValidSkillId(skillId)) {
    console.error(`Error: Unknown skill "${skillId}"`);
    console.error(`\nAvailable skills: ${skillIds.join(", ")}`);
    return 1;
  }

  console.log(`Installing ${skillId}...`);

  try {
    const result = await installSkill(skillId, options);
    console.log(`✓ Installed ${result.skillId} to ${result.installedPath}`);
    console.log("\nReload your assistant/tooling to use the new skill.");
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    return 1;
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }

  const command = args[0];
  const dirFlagIndex = args.indexOf("--dir");
  const skillsDir =
    dirFlagIndex >= 0 ? args[dirFlagIndex + 1] : undefined;
  if (dirFlagIndex >= 0 && (!skillsDir || skillsDir.startsWith("--"))) {
    console.error("Error: Missing value for --dir.");
    console.error(
      "Usage: npx @opencoreagents/code-skills add <skill-id> --dir <skills-dir>"
    );
    return 1;
  }
  const flags = {
    force: args.includes("--force"),
    skillsDir,
  };

  if (command === "list") {
    await listSkills(flags);
    return 0;
  }

  if (command === "add") {
    const skillId = args[1];
    if (!skillId || skillId.startsWith("--")) {
      console.error("Error: Missing skill ID.");
      console.error("Usage: npx @opencoreagents/code-skills add <skill-id>");
      return 1;
    }
    return addSkill(skillId, flags);
  }

  console.error(`Error: Unknown command "${command}"`);
  printHelp();
  return 1;
}

main().then((code) => process.exit(code));
