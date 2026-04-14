import path from "node:path";

/** Resolve `skillsDirs` entries relative to the directory that contains the config file. */
export function resolveSkillDirs(configFile: string, dirs: string[]): string[] {
  const base = path.dirname(path.resolve(configFile));
  return dirs.map((d) => path.resolve(base, d));
}
