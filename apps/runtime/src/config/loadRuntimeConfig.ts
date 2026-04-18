import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { mergeWithDefaults } from "./defaults.js";
import { expandDeep } from "./expandPlaceholders.js";
import { resolveSkillDirs, resolveStackPath } from "./paths.js";
import { resolveStackWireSettings } from "./stackWire.js";
import type { ResolvedRuntimeStackConfig, RuntimeStackFileConfig } from "./types.js";

function parseFile(contents: string, filePath: string): RuntimeStackFileConfig {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return JSON.parse(contents) as RuntimeStackFileConfig;
  }
  if (ext === ".yaml" || ext === ".yml") {
    return yaml.load(contents) as RuntimeStackFileConfig;
  }
  throw new Error(`Unsupported config extension for ${filePath}; use .yaml, .yml, or .json`);
}

/**
 * Load and resolve stack config from a YAML or JSON file.
 * `RUNTIME_CONFIG` overrides the default path when `configPath` is omitted.
 */
export function loadRuntimeConfig(configPath?: string): {
  config: ResolvedRuntimeStackConfig;
  /** Absolute path to the file that was read. */
  configFile: string;
} {
  const rel = configPath?.trim() || process.env.RUNTIME_CONFIG?.trim() || "config/local.yaml";
  const configFile = path.resolve(process.cwd(), rel);
  let contents: string;
  try {
    contents = fs.readFileSync(configFile, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      throw new Error(
        `Config file not found: ${configFile}\nCopy a reference file in the same directory, e.g.\n  cp config/local.example.yaml config/local.yaml\nSee apps/runtime/README.md.`,
      );
    }
    throw e;
  }
  const raw = parseFile(contents, configFile);
  const merged = mergeWithDefaults(raw);
  const expanded = expandDeep(merged);
  const skillsDirs = resolveSkillDirs(configFile, expanded.openclaw.skillsDirs);
  return {
    config: {
      ...expanded,
      openclaw: { ...expanded.openclaw, skillsDirs },
      artifacts: {
        ...expanded.artifacts,
        rootDir: resolveStackPath(configFile, expanded.artifacts.rootDir),
      },
    },
    configFile,
  };
}

/** Dotenv lines matching {@link resolveStackWireSettings} (YAML + same env overrides) plus OpenClaw / LLM hints. */
export function configToProcessEnv(config: ResolvedRuntimeStackConfig): Record<string, string> {
  const s = resolveStackWireSettings(config);
  const out: Record<string, string> = {
    PORT: String(s.port),
    PROJECT_ID: s.projectId,
    REDIS_URL: s.redisUrl,
    DEF_KEY_PREFIX: s.defKeyPrefix,
    RUN_WAIT_TIMEOUT_MS: String(s.runWaitTimeoutMs),
    ENGINE_QUEUE_NAME: s.engineQueueName,
    RUNTIME_ENVIRONMENT: config.environment,
    OPENCLAW_ENABLED: config.openclaw.enabled ? "1" : "0",
  };
  if (config.openclaw.skillsDirs.length > 0) {
    out.OPENCLAW_SKILLS_DIRS = config.openclaw.skillsDirs.join(path.delimiter);
  }
  out.LLM_DEFAULT_PROVIDER = config.llm.defaultProvider;
  if (config.runEvents.redis) {
    out.RUNTIME_RUN_EVENTS_REDIS = "1";
  }
  return out;
}
