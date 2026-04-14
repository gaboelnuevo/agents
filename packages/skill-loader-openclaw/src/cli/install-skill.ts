import * as path from "node:path";
import readline from "node:readline/promises";
import { installClawhubSkill, ClawhubInstallError } from "../clawhubInstall.js";

function printHelp(): void {
  console.log(`openclaw-skill-install — download a ClawHub skill (SKILL.md bundle)

Usage:
  openclaw-skill-install <slug> [options]
  pnpm exec openclaw-skill-install <slug> [options]

Options:
  --cwd <dir>       Project root (default: current working directory)
  --skills-dir <d>  Folder under cwd for skill folders (default: skills)
  --registry <url>  ClawHub API origin (default: https://clawhub.ai or CLAWHUB_REGISTRY)
  --version <ver>   Semver to install (default: latest from registry)
  --force           Overwrite existing folder; allow “suspicious” skills without prompting
  --token <t>       Bearer token (optional; or CLAWHUB_TOKEN for private skills)
  -h, --help        Show this message

Examples:
  pnpm --filter @opencoreagents/skill-loader-openclaw run skills:install -- my-skill
  node dist/cli/install-skill.js summarize --cwd . --force
`);
}

type RawFlags = Record<string, string | boolean>;

/** Args after the CLI script (tsx puts extra entries before user flags). */
function userArgv(): string[] {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!.replace(/\\/g, "/");
    if (
      a.includes("/cli/install-skill.") ||
      a.endsWith("/install-skill.ts") ||
      a.endsWith("/install-skill.js")
    ) {
      return argv.slice(i + 1);
    }
  }
  return argv.slice(2);
}

function parseArgv(argv: string[]): { positionals: string[]; flags: RawFlags } {
  const positionals: string[] = [];
  const flags: RawFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-h" || a === "--help") {
      flags.help = true;
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

function resolveRoot(cwd: string, flags: RawFlags): { ok: true; path: string } | { ok: false; message: string } {
  const raw = flags.cwd;
  if (raw === undefined || raw === true) return { ok: true, path: cwd };
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, message: "--cwd expects a directory path." };
  }
  const p = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  return { ok: true, path: p };
}

async function main(): Promise<number> {
  const cwd = process.cwd();
  const { positionals, flags } = parseArgv(userArgv());
  if (flags.help) {
    printHelp();
    return 0;
  }

  const slug = positionals[0]?.trim();
  if (!slug || slug === "-h") {
    if (slug === "-h") {
      printHelp();
      return 0;
    }
    console.error("Missing <slug>. Example: openclaw-skill-install summarize");
    printHelp();
    return 1;
  }
  if (slug === "--help") {
    printHelp();
    return 0;
  }

  const root = resolveRoot(cwd, flags);
  if (!root.ok) {
    console.error(root.message);
    return 1;
  }

  const skillsDirRel =
    typeof flags["skills-dir"] === "string" && flags["skills-dir"].trim()
      ? flags["skills-dir"].trim()
      : "skills";
  const skillsDir = path.resolve(root.path, skillsDirRel);

  const registry =
    typeof flags.registry === "string" && flags.registry.trim() ? flags.registry.trim() : undefined;
  const version =
    typeof flags.version === "string" && flags.version.trim() ? flags.version.trim() : undefined;
  const force = flags.force === true;
  const token =
    typeof flags.token === "string" && flags.token.trim() ? flags.token.trim() : undefined;

  const tryInstall = (allowSuspicious: boolean) =>
    installClawhubSkill({
      slug,
      skillsDir,
      registry,
      version,
      force,
      token,
      allowSuspicious: allowSuspicious || force,
    });

  try {
    const r = await tryInstall(false);
    console.log(`OK: ${r.slug}@${r.version} -> ${r.installedPath}`);
    return 0;
  } catch (e) {
    if (
      e instanceof ClawhubInstallError &&
      e.code === "SUSPICIOUS_REQUIRES_FORCE" &&
      process.stdin.isTTY &&
      process.stdout.isTTY &&
      !force
    ) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const ans = (
          await rl.question(
            "This skill is flagged suspicious on ClawHub. Install anyway? [y/N] ",
          )
        )
          .trim()
          .toLowerCase();
        if (ans !== "y" && ans !== "yes") {
          console.error("Installation cancelled.");
          return 1;
        }
      } finally {
        rl.close();
      }
      try {
        const r = await tryInstall(true);
        console.log(`OK: ${r.slug}@${r.version} -> ${r.installedPath}`);
        return 0;
      } catch (e2) {
        console.error(e2 instanceof Error ? e2.message : e2);
        return 1;
      }
    }
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}

main().then((code) => process.exit(code));
