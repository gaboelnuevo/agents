import fs from "node:fs/promises";
import path from "node:path";
import { Tool } from "@opencoreagents/core";

export const RUNTIME_WRITE_ARTIFACT_TOOL_ID = "system_write_artifact";

export interface RuntimeArtifactToolConfig {
  enabled: boolean;
  rootDir: string;
  publicBaseUrl?: string;
}

function projectNamespace(projectId: string): string {
  const cleaned = projectId.trim().replace(/[\\/]+/g, "_");
  if (!cleaned) {
    throw new Error("system_write_artifact: projectId is required");
  }
  return cleaned;
}

function normalizeRelativeArtifactPath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, "/");
  const cleaned = trimmed.replace(/^\/+/, "");
  if (!cleaned) {
    throw new Error("system_write_artifact: path is required");
  }
  const normalized = path.posix.normalize(cleaned);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("system_write_artifact: path must stay inside the configured artifact root");
  }
  return normalized;
}

function bodyFromInput(content: unknown, format?: string): Buffer {
  const normalized = typeof format === "string" ? format.trim().toLowerCase() : "";
  if (normalized === "base64") {
    if (typeof content !== "string") {
      throw new Error("system_write_artifact: base64 format requires string content");
    }
    return Buffer.from(content, "base64");
  }
  if (normalized === "json" || (normalized === "" && typeof content === "object" && content != null)) {
    return Buffer.from(JSON.stringify(content, null, 2) + "\n", "utf8");
  }
  if (typeof content !== "string") {
    throw new Error("system_write_artifact: text format requires string content");
  }
  return Buffer.from(content, "utf8");
}

function publicUrlFor(baseUrl: string | undefined, relativePath: string): string | undefined {
  const base = (baseUrl ?? "").trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/${relativePath.split(path.sep).join("/")}`;
}

export async function registerRuntimeArtifactTool(
  config: RuntimeArtifactToolConfig,
): Promise<void> {
  if (!config.enabled) return;

  await fs.mkdir(config.rootDir, { recursive: true });

  await Tool.define({
    id: RUNTIME_WRITE_ARTIFACT_TOOL_ID,
    scope: "global",
    description:
      "Writes an artifact file under the runtime artifact root, isolated by projectId. Use for planner outputs such as reports, JSON, markdown, or generated assets.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative artifact path under the configured artifact root.",
        },
        content: {
          description: "Artifact content. String for text/base64, object for json.",
        },
        format: {
          type: "string",
          enum: ["text", "json", "base64"],
          description: "How to serialize content. Default: text for strings, json for objects.",
        },
      },
      required: ["path", "content"],
    },
    execute: async (input, ctx) => {
      const args =
        input != null && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const relativePath = normalizeRelativeArtifactPath(String(args.path ?? ""));
      const projectId = projectNamespace(ctx.projectId);
      const projectScopedRoot = path.resolve(config.rootDir, projectId);
      const outputPath = path.resolve(projectScopedRoot, relativePath);
      const rootResolved = path.resolve(config.rootDir);
      if (outputPath !== rootResolved && !outputPath.startsWith(rootResolved + path.sep)) {
        throw new Error("system_write_artifact: resolved path escapes the configured artifact root");
      }

      const body = bodyFromInput(args.content, typeof args.format === "string" ? args.format : undefined);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, body);

      return {
        success: true,
        projectId,
        path: relativePath,
        scopedPath: `${projectId}/${relativePath.split(path.sep).join("/")}`,
        absolutePath: outputPath,
        bytes: body.byteLength,
        ...(publicUrlFor(config.publicBaseUrl, `${projectId}/${relativePath}`)
          ? { publicUrl: publicUrlFor(config.publicBaseUrl, `${projectId}/${relativePath}`) }
          : {}),
      };
    },
  });
}
