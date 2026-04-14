import { loadRuntimeConfig } from "./loadRuntimeConfig.js";
import { resolveStackWireSettings } from "./stackWire.js";
import type { ResolvedRuntimeStackConfig } from "./types.js";
import type { StackWireSettings } from "./stackWire.js";

export type { StackWireSettings } from "./stackWire.js";
export { resolveStackWireSettings } from "./stackWire.js";

/**
 * Load stack file (**`RUNTIME_CONFIG`** or `config/local.yaml`) once and expose both the full
 * merged config (e.g. **`llm`**) and **wire settings** for HTTP/Redis/BullMQ.
 *
 * Prefer this in **`server.ts`** / **`worker.ts`** instead of reading `process.env` directly for
 * stack fields — YAML is the source of truth; env vars only **override** when set (see {@link resolveStackWireSettings}).
 * Shared Redis store wiring and sync/OpenClaw helpers: {@link createDefinitionsRedisStore} in **`runtimeShared.ts`**.
 */
export function loadStackRuntime(configPath?: string): {
  config: ResolvedRuntimeStackConfig;
  configFile: string;
  stack: StackWireSettings;
} {
  const { config, configFile } = loadRuntimeConfig(configPath);
  return { config, configFile, stack: resolveStackWireSettings(config) };
}
