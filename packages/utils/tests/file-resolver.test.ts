import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveSource,
  FileOutsideRootError,
  HttpSourceNotAllowedError,
} from "../src/file-resolver/index.js";
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
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

  describe("localRoot sandbox", () => {
    it("reads a relative path under root", async () => {
      const root = fsSafeMkdtemp();
      const rel = "sub/a.txt";
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "scoped");
      try {
        const res = await resolveSource(rel, { localRoot: root });
        expect(res.buffer.toString()).toBe("scoped");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("rejects absolute user path without allowOutsideLocalRoot", async () => {
      const root = fsSafeMkdtemp();
      const abs = path.join(root, "b.txt");
      writeFileSync(abs, "x");
      try {
        await expect(resolveSource(abs, { localRoot: root })).rejects.toThrow(
          FileOutsideRootError,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("rejects .. segments", async () => {
      const root = fsSafeMkdtemp();
      try {
        await expect(
          resolveSource("../outside", { localRoot: root }),
        ).rejects.toThrow(FileOutsideRootError);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("rejects symlink that escapes root", async () => {
      const root = fsSafeMkdtemp();
      const outside = path.join(os.tmpdir(), `resolve-out-${Date.now()}.txt`);
      writeFileSync(outside, "secret");
      const link = path.join(root, "evil.txt");
      try {
        symlinkSync(outside, link);
        await expect(
          resolveSource("evil.txt", { localRoot: root }),
        ).rejects.toThrow(FileOutsideRootError);
      } finally {
        rmSync(root, { recursive: true, force: true });
        try {
          unlinkSync(outside);
        } catch {
          /* ignore */
        }
      }
    });

    it("allows absolute path when allowOutsideLocalRoot is true", async () => {
      const root = fsSafeMkdtemp();
      const abs = path.join(root, "c.txt");
      writeFileSync(abs, "free");
      try {
        const res = await resolveSource(abs, {
          localRoot: root,
          allowOutsideLocalRoot: true,
        });
        expect(res.buffer.toString()).toBe("free");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("http(s) policy", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("rejects http when allowHttp is false", async () => {
      await expect(
        resolveSource("https://example.com/x", { allowHttp: false }),
      ).rejects.toThrow(HttpSourceNotAllowedError);
    });

    it("rejects host not in allowlist when allowHttp true", async () => {
      await expect(
        resolveSource("https://evil.test/a", {
          allowHttp: true,
          httpHostsAllowlist: ["cdn.example.org"],
        }),
      ).rejects.toThrow(HttpSourceNotAllowedError);
    });

    it("allows listed host then fetches", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("ok").buffer,
        headers: { get: () => "text/plain" },
      });
      vi.stubGlobal("fetch", fetchMock);
      const res = await resolveSource("https://cdn.example.org/doc.txt", {
        allowHttp: true,
        httpHostsAllowlist: ["cdn.example.org"],
      });
      expect(res.buffer.toString()).toBe("ok");
      expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.org/doc.txt");
    });

    it("restricts hosts when only allowlist is set (no allowHttp flag)", async () => {
      await expect(
        resolveSource("https://nope.test/a", {
          httpHostsAllowlist: ["allowed.test"],
        }),
      ).rejects.toThrow(HttpSourceNotAllowedError);
    });

    it("legacy: no http options still fetches any host", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        headers: { get: () => null },
      });
      vi.stubGlobal("fetch", fetchMock);
      await resolveSource("https://legacy.example/file.bin");
      expect(fetchMock).toHaveBeenCalledWith("https://legacy.example/file.bin");
    });
  });
});

function fsSafeMkdtemp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "resolve-root-"));
}
