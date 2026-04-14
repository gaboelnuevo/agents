#!/usr/bin/env node
import { configToProcessEnv, loadRuntimeConfig } from "./loadRuntimeConfig.js";

const [, , cmd, ...rest] = process.argv;
const configArg = rest.find((a) => !a.startsWith("-"));
const strict = rest.includes("--strict");

/** Dotenv / docker-compose `env_file` compatible lines. */
function escapeEnvValue(v: string): string {
  if (v === "") return "";
  if (/[\s#"'\\]/.test(v)) return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return v;
}

function printEnvLines(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.stdout.write(`${k}=${escapeEnvValue(v)}\n`);
  }
}

function main(): void {
  if (cmd === "print") {
    const { config, configFile } = loadRuntimeConfig(configArg);
    process.stdout.write(JSON.stringify({ configFile, config }, null, 2) + "\n");
    return;
  }

  if (cmd === "env") {
    const { config } = loadRuntimeConfig(configArg);
    if (strict && !config.redis.url.trim()) {
      console.error("runtime-config: redis.url is empty after expansion (set REDIS_URL or fix config)");
      process.exit(1);
    }
    printEnvLines(configToProcessEnv(config));
    return;
  }

  process.stderr.write(`Usage:
  pnpm config:print [path/to/config.yaml|json]
  pnpm config:env [path/to/config.yaml|json] [--strict]

Environment:
  RUNTIME_CONFIG   default when no path is passed: config/local.yaml (copy from config/local.example.yaml)

Commands:
  print   merged + expanded config as JSON (includes resolved config path)
  env     KEY=value lines for shells: set -a && source <(pnpm config:env)   (bash)
`);
  process.exit(cmd ? 1 : 0);
}

main();
