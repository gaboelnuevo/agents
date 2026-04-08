import type { ParseResult } from "./types.js";

const MIME_MAP: Record<string, (buf: Buffer) => Promise<ParseResult>> = {
  "text/plain": parsePlainText,
  "text/markdown": parsePlainText,
  "text/csv": parseCsv,
  "text/html": parseHtml,
  "application/json": parseJson,
};

async function parsePlainText(buf: Buffer): Promise<ParseResult> {
  return {
    text: buf.toString("utf-8"),
    metadata: { mimeType: "text/plain", encoding: "utf-8" },
  };
}

async function parseCsv(buf: Buffer): Promise<ParseResult> {
  const raw = buf.toString("utf-8");
  return {
    text: raw,
    metadata: { mimeType: "text/csv", encoding: "utf-8" },
  };
}

async function parseHtml(buf: Buffer): Promise<ParseResult> {
  const raw = buf.toString("utf-8");
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  return {
    text: stripped,
    metadata: {
      mimeType: "text/html",
      encoding: "utf-8",
      title: titleMatch?.[1]?.trim(),
    },
  };
}

async function parseJson(buf: Buffer): Promise<ParseResult> {
  const raw = buf.toString("utf-8");
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    formatted = raw;
  }
  return {
    text: formatted,
    metadata: { mimeType: "application/json", encoding: "utf-8" },
  };
}

/**
 * Convert a raw file buffer into plain text with metadata.
 * Supports txt, md, csv, html, json out of the box.
 * PDF and DOCX require external libraries — install them and
 * register via `registerParser(mime, fn)` if needed.
 */
export async function parseFile(
  buffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const normalised = mimeType.split(";")[0]!.trim().toLowerCase();
  const parser = MIME_MAP[normalised] ?? customParsers.get(normalised);
  if (!parser) {
    throw new Error(
      `parseFile: unsupported mimeType "${normalised}". ` +
      `Supported: ${[...Object.keys(MIME_MAP), ...customParsers.keys()].join(", ")}`,
    );
  }
  return parser(buffer);
}

const customParsers = new Map<
  string,
  (buf: Buffer) => Promise<ParseResult>
>();

export function registerParser(
  mimeType: string,
  fn: (buf: Buffer) => Promise<ParseResult>,
): void {
  customParsers.set(mimeType.toLowerCase(), fn);
}

export type { ParseResult };
