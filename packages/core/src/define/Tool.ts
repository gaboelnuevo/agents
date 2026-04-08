import type { ToolDefinition } from "./types.js";
import type { ToolAdapter } from "../adapters/tool/ToolAdapter.js";
import { registerToolDefinition, registerToolHandler } from "./registry.js";

export class Tool {
  static async define(
    def: ToolDefinition & { execute?: ToolAdapter["execute"] },
  ): Promise<void> {
    registerToolDefinition(def);
    if (def.execute) {
      registerToolHandler({
        name: def.id,
        description: def.description,
        execute: def.execute,
      });
    }
  }
}
