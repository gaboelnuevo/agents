import { mkdir, access, writeFile, stat } from "node:fs/promises";
import path from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export function toProjectRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export async function writeTextFile(
  root: string,
  relativePosix: string,
  contents: string,
  opts: { force: boolean },
): Promise<"created" | "skipped"> {
  const abs = path.join(root, ...relativePosix.split("/"));
  const exists = await pathExists(abs);
  if (exists && !opts.force) {
    const st = await stat(abs);
    if (st.isFile()) return "skipped";
  }
  await ensureParentDir(abs);
  await writeFile(abs, contents, "utf8");
  return "created";
}
