import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedFile } from "./types.js";

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
 */
export async function resolveSource(source: string): Promise<ResolvedFile> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return resolveHttp(source);
  }
  return resolveLocal(source);
}

export type { ResolvedFile };
