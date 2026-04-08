import type { MemoryScope } from "../adapters/memory/MemoryAdapter.js";
import type { ToolAdapter, ToolContext } from "../adapters/tool/ToolAdapter.js";
import { registerToolDefinition, registerToolHandler } from "../define/registry.js";

function scopeFromContext(ctx: ToolContext): MemoryScope {
  return {
    projectId: ctx.projectId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    endUserId: ctx.endUserId,
  };
}

const saveMemory: ToolAdapter = {
  name: "save_memory",
  description: "Persists content in the agent memory store.",
  validate(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    const o = input as Record<string, unknown>;
    return (
      typeof o.memoryType === "string" &&
      o.content !== undefined
    );
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as { memoryType: string; content: unknown };
    await ctx.memoryAdapter.save(scopeFromContext(ctx), o.memoryType, o.content);
    return { success: true };
  },
};

const getMemory: ToolAdapter = {
  name: "get_memory",
  description: "Queries stored memory fragments.",
  validate(input: unknown): boolean {
    if (!input || typeof input !== "object") return false;
    const o = input as Record<string, unknown>;
    return typeof o.memoryType === "string";
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as { memoryType: string; filter?: unknown };
    const rows = await ctx.memoryAdapter.query(
      scopeFromContext(ctx),
      o.memoryType,
      o.filter,
    );
    return { success: true, data: rows };
  },
};

/** Register built-in tool handlers (call once at process startup). */
export function registerBuiltinToolHandlers(): void {
  registerToolDefinition({
    id: "save_memory",
    scope: "global",
    description: saveMemory.description,
    inputSchema: {
      type: "object",
      properties: {
        memoryType: { enum: ["shortTerm", "longTerm", "working"] },
        content: {},
      },
      required: ["memoryType", "content"],
    },
    roles: ["agent"],
  });
  registerToolDefinition({
    id: "get_memory",
    scope: "global",
    description: getMemory.description,
    inputSchema: {
      type: "object",
      properties: {
        memoryType: { type: "string" },
        filter: {},
      },
      required: ["memoryType"],
    },
    roles: ["agent"],
  });
  registerToolHandler(saveMemory);
  registerToolHandler(getMemory);
}
