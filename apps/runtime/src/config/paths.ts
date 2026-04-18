import path from "node:path";

/** Resolve `skillsDirs` entries relative to the directory that contains the config file. */
export function resolveSkillDirs(configFile: string, dirs: string[]): string[] {
  const base = path.dirname(path.resolve(configFile));
  return dirs.map((d) => path.resolve(base, d));
}

/** Resolve a single stack path relative to the directory that contains the config file. */
export function resolveStackPath(configFile: string, targetPath: string): string {
  const base = path.dirname(path.resolve(configFile));
  return path.resolve(base, targetPath);
}
