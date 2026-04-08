import type { ToolContext } from "@agent-runtime/core";
import type { ResolvedFile } from "@agent-runtime/utils";
import { resolveSource } from "@agent-runtime/utils";

function isHttpSource(s: string): boolean {
  const t = s.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}

/**
 * Resolves a `source` string for RAG file tools: http(s) requires
 * `ToolContext.allowHttpFileSources` (optional host allowlist); local paths require
 * `ToolContext.fileReadRoot` unless `allowFileReadOutsideRoot` is explicitly true.
 */
export async function resolveSourceForTool(
  source: string,
  ctx: Pick<
    ToolContext,
    | "fileReadRoot"
    | "allowFileReadOutsideRoot"
    | "allowHttpFileSources"
    | "httpFileSourceHostsAllowlist"
  >,
): Promise<ResolvedFile> {
  const src = source.trim();
  if (isHttpSource(src)) {
    if (ctx.allowHttpFileSources !== true) {
      throw new Error(
        "http(s) sources require Session.allowHttpFileSources (mitigates SSRF).",
      );
    }
    return resolveSource(src, {
      allowHttp: true,
      httpHostsAllowlist: ctx.httpFileSourceHostsAllowlist,
    });
  }
  if (ctx.allowFileReadOutsideRoot === true) {
    return resolveSource(src);
  }
  if (ctx.fileReadRoot) {
    return resolveSource(src, {
      localRoot: ctx.fileReadRoot,
      allowOutsideLocalRoot: false,
    });
  }
  throw new Error(
    "Local file paths require Session.fileReadRoot, or set Session.allowFileReadOutsideRoot for explicit unrestricted local access.",
  );
}
