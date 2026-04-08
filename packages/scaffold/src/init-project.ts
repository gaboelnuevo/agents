import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { InitProjectOptions, ScaffoldManifest } from "./types.js";
import { writeTextFile } from "./fs-utils.js";
import { defaultTemplateFiles } from "./templates/default.js";
import { minimalTemplateFiles } from "./templates/minimal.js";
import { multiAgentTemplateFiles } from "./templates/multi-agent.js";

function resolvePackageManager(
  pm: InitProjectOptions["packageManager"],
): "npm" | "pnpm" | "yarn" {
  if (pm === "auto" || pm === undefined) return "pnpm";
  return pm;
}

function pickFiles(opts: {
  name: string;
  template: NonNullable<InitProjectOptions["template"]>;
  adapter: NonNullable<InitProjectOptions["adapter"]>;
  llm: NonNullable<InitProjectOptions["llm"]>;
  packageManager: "npm" | "pnpm" | "yarn";
}): Record<string, string> {
  const common = {
    name: opts.name,
    adapter: opts.adapter,
    llm: opts.llm,
    packageManager: opts.packageManager,
  };
  switch (opts.template) {
    case "minimal":
      return minimalTemplateFiles(common);
    case "multi-agent":
      return multiAgentTemplateFiles(common);
    default:
      return defaultTemplateFiles(common);
  }
}

export async function initProject(
  raw: InitProjectOptions,
): Promise<ScaffoldManifest> {
  const name = raw.name.trim();
  if (!name || /[/\\]/.test(name)) {
    throw new Error(
      'initProject: invalid `name` — use a single path segment (e.g. "my-project").',
    );
  }

  const projectRoot = path.resolve(raw.path);
  const template = raw.template ?? "default";
  const adapter = raw.adapter ?? "upstash";
  const llm = raw.llm ?? "openai";
  const packageManager = resolvePackageManager(raw.packageManager);
  const force = raw.force ?? false;

  await mkdir(projectRoot, { recursive: true });

  const files = pickFiles({
    name,
    template,
    adapter,
    llm,
    packageManager,
  });

  const created: string[] = [];
  const skipped: string[] = [];

  const ordered = Object.keys(files).sort();
  for (const rel of ordered) {
    const status = await writeTextFile(projectRoot, rel, files[rel]!, {
      force,
    });
    const manifestPath = rel;
    if (status === "created") created.push(manifestPath);
    else skipped.push(manifestPath);
  }

  return { created, skipped };
}
