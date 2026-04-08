import type { ToolAdapter, ToolContext } from "@agent-runtime/core";
import { parseFile } from "@agent-runtime/utils";
import { resolveSourceForTool } from "./resolveFileSource.js";

export const fileReadTool: ToolAdapter = {
  name: "file_read",
  description:
    "Reads a file and returns its extracted text content. " +
    "Supports: txt, md, json, csv, html.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as { source: string };
    const resolved = await resolveSourceForTool(o.source, ctx);
    const parsed = await parseFile(resolved.buffer, resolved.mimeType);
    return {
      success: true,
      content: parsed.text,
      metadata: { ...parsed.metadata, size: resolved.size, name: resolved.name },
    };
  },
};

export const fileReadDefinition = {
  id: "file_read",
  scope: "global" as const,
  description: fileReadTool.description!,
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "http(s) URL only if Session.allowHttpFileSources (optional httpFileSourceHostsAllowlist); " +
          "or local path relative to Session.fileReadRoot unless allowFileReadOutsideRoot",
      },
    },
    required: ["source"],
  },
  roles: ["admin", "operator"],
};
