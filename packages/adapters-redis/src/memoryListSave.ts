import type Redis from "ioredis";

/**
 * Append one memory fragment atomically using Redis LIST (`RPUSH`).
 * Legacy keys stored as a STRING containing a JSON array are migrated once (non-atomic vs other
 * migrators — rare); after migration, concurrent appends are safe.
 */
export async function appendMemoryListEntry(redis: Redis, key: string, content: unknown): Promise<void> {
  const typ = await redis.type(key);
  if (typ === "string") {
    await migrateLegacyJsonArrayToList(redis, key);
  }
  await redis.rpush(key, JSON.stringify(content));
}

export async function readMemoryList(redis: Redis, key: string): Promise<unknown[]> {
  const typ = await redis.type(key);
  if (typ === "none") return [];
  if (typ === "list") {
    const parts = await redis.lrange(key, 0, -1);
    return parts.map((p) => JSON.parse(p) as unknown);
  }
  if (typ === "string") {
    const raw = await redis.get(key);
    if (raw == null || raw === "") return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function migrateLegacyJsonArrayToList(redis: Redis, key: string): Promise<void> {
  const raw = await redis.get(key);
  await redis.del(key);
  if (raw == null || raw === "") return;
  let arr: unknown[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    arr = [];
  }
  if (arr.length === 0) return;
  const pipeline = redis.pipeline();
  for (const item of arr) {
    pipeline.rpush(key, JSON.stringify(item));
  }
  await pipeline.exec();
}
