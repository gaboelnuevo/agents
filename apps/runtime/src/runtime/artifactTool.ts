import fs from "node:fs/promises";
import path from "node:path";
import { Tool } from "@opencoreagents/core";

export const RUNTIME_WRITE_ARTIFACT_TOOL_ID = "system_write_artifact";
export const RUNTIME_LIST_ARTIFACTS_TOOL_ID = "system_list_artifacts";

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

function sessionNamespace(sessionId: string): string {
  const cleaned = sessionId.trim().replace(/[\\/]+/g, "_");
  if (!cleaned) {
    throw new Error("system_write_artifact: sessionId is required");
  }
  return cleaned;
}

/**
 * Get the effective session ID for artifacts.
 * If the current session was invoked by another session (planner sub-agents),
 * use the parent session ID so all artifacts are scoped together.
 */
function getArtifactSessionId(ctx: { sessionId: string; sessionContext?: Readonly<Record<string, unknown>> }): string {
  const parentSessionId = ctx.sessionContext?.invokedBySessionId;
  if (typeof parentSessionId === "string" && parentSessionId.length > 0) {
    return parentSessionId;
  }
  return ctx.sessionId;
}

function normalizeRelativeArtifactPath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, "/");
  const cleaned = trimmed.replace(/^\/+/ , "");
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

async function listArtifactsRecursive(
  dir: string,
  prefix: string,
  baseUrl: string | undefined,
  projectId: string,
  sessionId: string,
): Promise<Array<{ path: string; scopedPath: string; publicUrl?: string; size: number }>> {
  const results: Array<{ path: string; scopedPath: string; publicUrl?: string; size: number }> = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const scopedUrlPath = `${projectId}/${sessionId}/${relativePath}`;
      
      if (entry.isDirectory()) {
        const subResults = await listArtifactsRecursive(
          fullPath,
          relativePath,
          baseUrl,
          projectId,
          sessionId,
        );
        results.push(...subResults);
      } else {
        const stats = await fs.stat(fullPath);
        results.push({
          path: relativePath,
          scopedPath: scopedUrlPath,
          ...(publicUrlFor(baseUrl, scopedUrlPath)
            ? { publicUrl: publicUrlFor(baseUrl, scopedUrlPath) }
            : {}),
          size: stats.size,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read, return empty
  }
  
  return results;
}

export async function registerRuntimeArtifactTools(
  config: RuntimeArtifactToolConfig,
): Promise<void> {
  if (!config.enabled) return;

  await fs.mkdir(config.rootDir, { recursive: true });

  // Write artifact tool
  await Tool.define({
    id: RUNTIME_WRITE_ARTIFACT_TOOL_ID,
    scope: "global",
    description:
      "Writes an artifact file under the runtime artifact root, isolated by projectId and sessionId. If the current session was spawned by a parent session (e.g., planner sub-agents), artifacts are scoped to the parent session. Use for planner outputs such as reports, JSON, markdown, or generated assets.",
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
      const artifactSessionId = sessionNamespace(getArtifactSessionId(ctx));
      const scopedRoot = path.resolve(config.rootDir, projectId, artifactSessionId);
      const outputPath = path.resolve(scopedRoot, relativePath);
      const rootResolved = path.resolve(config.rootDir);
      if (outputPath !== rootResolved && !outputPath.startsWith(rootResolved + path.sep)) {
        throw new Error("system_write_artifact: resolved path escapes the configured artifact root");
      }

      const body = bodyFromInput(args.content, typeof args.format === "string" ? args.format : undefined);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, body);

      const scopedUrlPath = `${projectId}/${artifactSessionId}/${relativePath.split(path.sep).join("/")}`;

      return {
        success: true,
        projectId,
        sessionId: artifactSessionId,
        path: relativePath,
        scopedPath: scopedUrlPath,
        absolutePath: outputPath,
        bytes: body.byteLength,
        ...(publicUrlFor(config.publicBaseUrl, scopedUrlPath)
          ? { publicUrl: publicUrlFor(config.publicBaseUrl, scopedUrlPath) }
          : {}),
      };
    },
  });

  // List artifacts tool
  await Tool.define({
    id: RUNTIME_LIST_ARTIFACTS_TOOL_ID,
    scope: "global",
    description:
      "Lists all artifacts for the current session. If the current session was spawned by a parent session (e.g., planner sub-agents), lists artifacts from the parent session. Returns an array of artifacts with their paths, sizes, and optional public URLs.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Optional prefix filter to list only artifacts under a specific subdirectory.",
        },
      },
    },
    execute: async (input, ctx) => {
      const args =
        input != null && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      
      const projectId = projectNamespace(ctx.projectId);
      const artifactSessionId = sessionNamespace(getArtifactSessionId(ctx));
      const prefix = typeof args.prefix === "string" ? normalizeRelativeArtifactPath(args.prefix) : "";
      
      const scopedRoot = path.resolve(config.rootDir, projectId, artifactSessionId);
      const listDir = prefix ? path.resolve(scopedRoot, prefix) : scopedRoot;
      
      const rootResolved = path.resolve(config.rootDir);
      if (listDir !== rootResolved && !listDir.startsWith(rootResolved + path.sep)) {
        throw new Error("system_list_artifacts: resolved path escapes the configured artifact root");
      }

      const artifacts = await listArtifactsRecursive(
        listDir,
        prefix,
        config.publicBaseUrl,
        projectId,
        artifactSessionId,
      );

      return {
        success: true,
        projectId,
        sessionId: artifactSessionId,
        prefix: prefix || undefined,
        count: artifacts.length,
        artifacts,
      };
    },
  });
}

// Backward compatibility - keep the old function name as an alias
export const registerRuntimeArtifactTool = registerRuntimeArtifactTools;
