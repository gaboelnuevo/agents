import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { ResolvedFile } from "./types.js";

export type { ResolvedFile } from "./types.js";

const EXT_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Local path resolved outside an allowed root without {@link ResolveSourceOptions.allowOutsideLocalRoot}. */
export class FileOutsideRootError extends Error {
  readonly code = "FILE_OUTSIDE_ROOT" as const;
  constructor(message: string) {
    super(message);
    this.name = "FileOutsideRootError";
  }
}

/** HTTP(S) fetch blocked by {@link ResolveSourceOptions.allowHttp} or host allowlist. */
export class HttpSourceNotAllowedError extends Error {
  readonly code = "HTTP_SOURCE_NOT_ALLOWED" as const;
  constructor(message: string) {
    super(message);
    this.name = "HttpSourceNotAllowedError";
  }
}

export interface ResolveSourceOptions {
  /**
   * When set, local filesystem sources must stay under this directory (after resolving symlinks),
   * unless {@link allowOutsideLocalRoot} is true.
   */
  localRoot?: string;
  /**
   * Explicit opt-in to read local paths outside {@link localRoot}, including absolute paths
   * anywhere on the filesystem. Ignored when {@link localRoot} is not set.
   */
  allowOutsideLocalRoot?: boolean;
  /**
   * When `false`, http(s) `source` strings are rejected. When `true`, http(s) is allowed
   * (subject to {@link httpHostsAllowlist}). When omitted, http(s) is allowed unless
   * {@link httpHostsAllowlist} is non-empty (then only listed hosts are allowed).
   */
  allowHttp?: boolean;
  /**
   * If non-empty, http(s) URLs must use a hostname that matches an entry (case-insensitive, exact).
   */
  httpHostsAllowlist?: string[];
}

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

function mimeFromContentType(ct: string | null): string {
  if (!ct) return "application/octet-stream";
  return ct.split(";")[0]!.trim().toLowerCase();
}

async function resolveLocal(source: string): Promise<ResolvedFile> {
  const abs = path.resolve(source);
  const buffer = await readFile(abs);
  return {
    buffer,
    mimeType: mimeFromPath(abs),
    size: buffer.length,
    name: path.basename(abs),
  };
}

function joinStrictUnderRoot(rootDir: string, userPath: string): string {
  const root = path.resolve(rootDir);
  const trimmed = userPath.trim();
  if (!trimmed) {
    throw new FileOutsideRootError("Empty path");
  }
  if (path.isAbsolute(trimmed)) {
    throw new FileOutsideRootError(
      "Absolute local paths require allowOutsideLocalRoot",
    );
  }
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  if (parts.some((p) => p === "..")) {
    throw new FileOutsideRootError('Path traversal ("..") is not allowed');
  }
  return path.resolve(root, ...parts);
}

/**
 * Ensures the resolved path (after symlinks) stays under rootDir.
 * For missing files, checks that the parent directory is under root.
 */
async function assertRealPathUnderRoot(
  candidateAbs: string,
  rootDir: string,
): Promise<string> {
  const rootReal = await realpath(path.resolve(rootDir));
  try {
    const fileReal = await realpath(candidateAbs);
    const rel = path.relative(rootReal, fileReal);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new FileOutsideRootError("Path escapes root (symlink or layout)");
    }
    return fileReal;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") throw e;
    const dir = path.dirname(candidateAbs);
    if (dir === candidateAbs) {
      throw new FileOutsideRootError("Invalid path");
    }
    const dirReal = await realpath(dir);
    const relDir = path.relative(rootReal, dirReal);
    if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
      throw new FileOutsideRootError("Path escapes root (parent directory)");
    }
    return candidateAbs;
  }
}

async function resolveLocalUnderRoot(
  rootDir: string,
  source: string,
): Promise<ResolvedFile> {
  const candidate = joinStrictUnderRoot(rootDir, source);
  const finalPath = await assertRealPathUnderRoot(candidate, rootDir);
  const buffer = await readFile(finalPath);
  return {
    buffer,
    mimeType: mimeFromPath(finalPath),
    size: buffer.length,
    name: path.basename(finalPath),
  };
}

function normalizedHttpHostsAllowlist(
  list: string[] | undefined,
): string[] {
  return (list ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function assertHttpAllowed(
  source: string,
  options: ResolveSourceOptions | undefined,
): void {
  const trimmed = source.trim();
  const { allowHttp, httpHostsAllowlist } = options ?? {};
  const hosts = normalizedHttpHostsAllowlist(httpHostsAllowlist);

  if (allowHttp === false) {
    throw new HttpSourceNotAllowedError(
      "HTTP(S) sources are disabled (allowHttp: false)",
    );
  }

  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    throw new HttpSourceNotAllowedError("Invalid HTTP(S) URL");
  }

  if (allowHttp === true) {
    if (hosts.length > 0 && !hosts.includes(hostname)) {
      throw new HttpSourceNotAllowedError(
        `Host not in allowlist: ${hostname}`,
      );
    }
    return;
  }

  if (hosts.length > 0) {
    if (!hosts.includes(hostname)) {
      throw new HttpSourceNotAllowedError(
        `Host not in allowlist: ${hostname}`,
      );
    }
    return;
  }

  // Legacy: no options or no http constraints — allow any host.
}

async function resolveHttp(url: string): Promise<ResolvedFile> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`resolveSource HTTP ${res.status}: ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type");
  const urlPath = new URL(url).pathname;
  return {
    buffer,
    mimeType: mimeFromContentType(ct) || mimeFromPath(urlPath),
    size: buffer.length,
    name: path.basename(urlPath) || "download",
  };
}

/**
 * Resolve a source string to a buffer with mime type.
 * Supports local paths and http(s) URLs.
 * S3/GCS require external SDKs — extend with `registerResolver`.
 *
 * For untrusted `source` (e.g. LLM tool args), pass {@link ResolveSourceOptions.localRoot}
 * and keep {@link ResolveSourceOptions.allowOutsideLocalRoot} false unless you explicitly
 * allow reading arbitrary local paths. Use {@link ResolveSourceOptions.allowHttp} and
 * {@link ResolveSourceOptions.httpHostsAllowlist} to limit SSRF from URLs.
 */
export async function resolveSource(
  source: string,
  options?: ResolveSourceOptions,
): Promise<ResolvedFile> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    assertHttpAllowed(source, options);
    return resolveHttp(source.trim());
  }

  const { localRoot, allowOutsideLocalRoot } = options ?? {};
  if (localRoot && !allowOutsideLocalRoot) {
    return resolveLocalUnderRoot(localRoot, source);
  }
  return resolveLocal(source);
}
