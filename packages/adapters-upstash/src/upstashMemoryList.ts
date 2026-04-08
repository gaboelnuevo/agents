/** Upstash Redis REST command helper (same signature as {@link UpstashRedisMemoryAdapter} `cmd`). */
export type UpstashCmd = (args: (string | number)[]) => Promise<unknown>;

/**
 * Atomic append via Redis LIST (`RPUSH`). Migrates legacy STRING (JSON array) on first write.
 */
export async function appendMemoryListEntryUpstash(
  cmd: UpstashCmd,
  key: string,
  content: unknown,
): Promise<void> {
  const typ = String(await cmd(["TYPE", key]));
  if (typ === "string") {
    await migrateLegacyJsonArrayToListUpstash(cmd, key);
  }
  await cmd(["RPUSH", key, JSON.stringify(content)]);
}

export async function readMemoryListUpstash(cmd: UpstashCmd, key: string): Promise<unknown[]> {
  const typ = String(await cmd(["TYPE", key]));
  if (typ === "none") return [];
  if (typ === "list") {
    const raw = await cmd(["LRANGE", key, 0, -1]);
    const parts = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === "string"
        ? [raw]
        : [];
    return parts.map((p) => JSON.parse(p) as unknown);
  }
  if (typ === "string") {
    const raw = await cmd(["GET", key]);
    if (raw == null || raw === "") return [];
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function migrateLegacyJsonArrayToListUpstash(cmd: UpstashCmd, key: string): Promise<void> {
  const raw = await cmd(["GET", key]);
  await cmd(["DEL", key]);
  if (raw == null || raw === "") return;
  if (typeof raw !== "string") return;
  let arr: unknown[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    arr = [];
  }
  for (const item of arr) {
    await cmd(["RPUSH", key, JSON.stringify(item)]);
  }
}
