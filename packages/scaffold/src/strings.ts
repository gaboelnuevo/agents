/** `send-email` / `send_email` → `send_email` */
export function normalizeToolId(raw: string): string {
  const s = raw.trim().replace(/-/g, "_");
  return s.replace(/_+/g, "_");
}

/** `intake-summary` → `intakeSummary` */
export function toSkillIdCamel(raw: string): string {
  const parts = raw
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (parts.length === 0) return "skill";
  return parts
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
}

export function toPosixRelative(filePath: string, root: string): string {
  const rel = filePath.replace(/^[/\\]+/, "").replaceAll("\\", "/");
  const base = root.replace(/[/\\]+$/, "").replaceAll("\\", "/");
  if (rel.startsWith(base)) {
    return rel.slice(base.length).replace(/^[/\\]+/, "");
  }
  return rel;
}
