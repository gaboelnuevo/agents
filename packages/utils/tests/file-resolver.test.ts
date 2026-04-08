import { describe, it, expect } from "vitest";
import { resolveSource } from "../src/file-resolver/index.js";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("resolveSource", () => {
  it("reads a local file", async () => {
    const tmp = path.join(os.tmpdir(), `test-resolve-${Date.now()}.txt`);
    writeFileSync(tmp, "local content");
    try {
      const res = await resolveSource(tmp);
      expect(res.buffer.toString()).toBe("local content");
      expect(res.mimeType).toBe("text/plain");
      expect(res.name).toContain("test-resolve");
      expect(res.size).toBe(13);
    } finally {
      unlinkSync(tmp);
    }
  });

  it("throws on nonexistent local file", async () => {
    await expect(resolveSource("/no/such/file.txt")).rejects.toThrow();
  });
});
