import path from "node:path";
import { scaffold } from "@agent-runtime/scaffold";
import type {
  InitProjectOptions,
  ScaffoldAdapterPreset,
  ScaffoldLlmPreset,
  ScaffoldTemplate,
} from "@agent-runtime/scaffold";

function printHelp(): void {
  console.log(`@agent-runtime/cli — project scaffolding

Usage:
  agent-runtime init <name> [options]
  agent-runtime generate agent <id> [options]
  agent-runtime generate tool <id> [options]
  agent-runtime generate skill <id> [options]

Commands:
  init              Create a new project directory with template files.
  generate agent    Add an agent definition (and optional test) under ./agents.
  generate tool     Add a tool definition + handler stub under ./tools.
  generate skill    Add a skill definition under ./skills.

Init options:
  --template <default|minimal|multi-agent>   (default: default)
  --adapter <upstash|redis|memory>         (default: upstash)
  --llm <openai|anthropic|custom>           (default: openai)
  --package-manager <npm|pnpm|yarn|auto>    (default: auto → pnpm in API)
  --out <dir>                               Project root path (default: <cwd>/<name>)
  --force                                   Overwrite existing files

Generate options (all subcommands):
  --cwd <dir>       Project root (default: current working directory)
  --force           Overwrite existing files

Generate agent:
  --skills <a,b>    Comma-separated skill ids (default: [])
  --tools <a,b>     Comma-separated tool ids (default: save_memory,get_memory)
  --llm-model <m>   Model id written into generated agent (default: gpt-4o)
  --with-test       Generate tests/<id>.test.ts (default)
  --no-with-test    Skip companion test file

Generate skill:
  --tools <a,b>     Comma-separated tool ids (default: [])
`);
}

type RawFlags = Record<string, string | boolean>;

function parseArgv(argv: string[]): { positionals: string[]; flags: RawFlags } {
  const positionals: string[] = [];
  const flags: RawFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--no-with-test") {
      flags["with-test"] = false;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function splitComma(s: string | undefined): string[] {
  if (!s || typeof s !== "string") return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function resolveProjectRoot(
  cwd: string,
  flags: RawFlags,
): { ok: true; path: string } | { ok: false; message: string } {
  const raw = flags.cwd;
  if (raw === undefined || raw === true) return { ok: true, path: cwd };
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, message: "--cwd expects a directory path." };
  }
  const p = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  return { ok: true, path: p };
}

function printManifestSummary(label: string, m: { created: string[]; skipped: string[] }): void {
  console.log(label);
  if (m.created.length) {
    console.log("  Created:");
    for (const p of m.created) console.log(`    ${p}`);
  }
  if (m.skipped.length) {
    console.log("  Skipped (already exists, use --force to overwrite):");
    for (const p of m.skipped) console.log(`    ${p}`);
  }
}

async function runInit(
  cwd: string,
  positionals: string[],
  flags: RawFlags,
): Promise<number> {
  const name = positionals[0]?.trim();
  if (!name) {
    console.error("init: missing <name>. Example: agent-runtime init my-project");
    return 1;
  }

  const outRaw = flags.out;
  const projectRoot =
    typeof outRaw === "string" && outRaw.trim()
      ? path.isAbsolute(outRaw)
        ? outRaw
        : path.resolve(cwd, outRaw)
      : path.join(cwd, name);

  const template = (flags.template as string | undefined) as ScaffoldTemplate | undefined;
  const adapter = (flags.adapter as string | undefined) as ScaffoldAdapterPreset | undefined;
  const llm = (flags.llm as string | undefined) as ScaffoldLlmPreset | undefined;
  const pm = flags["package-manager"] as string | undefined;

  let packageManager: InitProjectOptions["packageManager"] = "auto";
  if (pm === "npm" || pm === "pnpm" || pm === "yarn") {
    packageManager = pm;
  } else if (pm === "auto" || pm === undefined) {
    packageManager = "auto";
  } else {
    console.error(`init: invalid --package-manager "${pm}". Use npm, pnpm, yarn, or auto.`);
    return 1;
  }

  const opts: InitProjectOptions = {
    name,
    path: projectRoot,
    template: template ?? "default",
    adapter: adapter ?? "upstash",
    llm: llm ?? "openai",
    packageManager,
    force: flags.force === true,
  };

  const m = await scaffold.initProject(opts);
  printManifestSummary(`✓ Project scaffold at ${projectRoot}`, m);
  console.log(`
  Next steps:
  1. cd ${path.relative(cwd, projectRoot) || "."}
  2. cp .env.example .env   # add API keys
  3. pnpm install           # or npm / yarn
  4. pnpm run dev           # when your template wires a dev script
`);
  return 0;
}

async function runGenerateAgent(
  cwd: string,
  positionals: string[],
  flags: RawFlags,
): Promise<number> {
  const agentId = positionals[0]?.trim();
  if (!agentId) {
    console.error("generate agent: missing <id>. Example: agent-runtime generate agent support-bot");
    return 1;
  }
  const root = resolveProjectRoot(cwd, flags);
  if (!root.ok) {
    console.error(root.message);
    return 1;
  }

  const withTest =
    flags["with-test"] === false ? false : flags["with-test"] === true ? true : true;

  const llmModel =
    typeof flags["llm-model"] === "string" ? flags["llm-model"] : undefined;

  const m = await scaffold.generateAgent({
    projectPath: root.path,
    agentId,
    skills: typeof flags.skills === "string" ? splitComma(flags.skills) : undefined,
    tools: typeof flags.tools === "string" ? splitComma(flags.tools) : undefined,
    withTest,
    llmModel,
    force: flags.force === true,
  });
  printManifestSummary(`✓ generate agent ${agentId}`, m);
  return 0;
}

async function runGenerateTool(
  cwd: string,
  positionals: string[],
  flags: RawFlags,
): Promise<number> {
  const toolId = positionals[0]?.trim();
  if (!toolId) {
    console.error("generate tool: missing <id>. Example: agent-runtime generate tool send-email");
    return 1;
  }
  const root = resolveProjectRoot(cwd, flags);
  if (!root.ok) {
    console.error(root.message);
    return 1;
  }
  const m = await scaffold.generateTool({
    projectPath: root.path,
    toolId,
    force: flags.force === true,
  });
  printManifestSummary(`✓ generate tool ${toolId}`, m);
  return 0;
}

async function runGenerateSkill(
  cwd: string,
  positionals: string[],
  flags: RawFlags,
): Promise<number> {
  const skillId = positionals[0]?.trim();
  if (!skillId) {
    console.error(
      "generate skill: missing <id>. Example: agent-runtime generate skill intake-summary --tools save_memory,get_memory",
    );
    return 1;
  }
  const root = resolveProjectRoot(cwd, flags);
  if (!root.ok) {
    console.error(root.message);
    return 1;
  }
  const m = await scaffold.generateSkill({
    projectPath: root.path,
    skillId,
    tools: typeof flags.tools === "string" ? splitComma(flags.tools) : undefined,
    force: flags.force === true,
  });
  printManifestSummary(`✓ generate skill ${skillId}`, m);
  return 0;
}

/**
 * Run the CLI and return an exit code (0 = success). Parses `argv` as `process.argv.slice(2)` would.
 */
export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return 0;
  }

  const cwd = process.cwd();
  const { positionals, flags } = parseArgv(argv);

  if (positionals[0] === "init") {
    return runInit(cwd, positionals.slice(1), flags);
  }

  if (positionals[0] === "generate") {
    const sub = positionals[1];
    const rest = positionals.slice(2);
    if (sub === "agent") return runGenerateAgent(cwd, rest, flags);
    if (sub === "tool") return runGenerateTool(cwd, rest, flags);
    if (sub === "skill") return runGenerateSkill(cwd, rest, flags);
    console.error(`Unknown generate target: ${sub ?? "(missing)"}. Use agent, tool, or skill.`);
    return 1;
  }

  console.error(`Unknown command: ${positionals[0]}. Try: agent-runtime --help`);
  return 1;
}
