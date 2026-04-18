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
  name: "system_save_memory",
  description: "Persists content in the agent memory store.",
  validate(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, reason: "input must be an object" };
    }
    const o = input as Record<string, unknown>;
    if (typeof o.memoryType !== "string") {
      return { ok: false, reason: "memoryType must be a string" };
    }
    if (
      o.memoryType !== "shortTerm" &&
      o.memoryType !== "longTerm" &&
      o.memoryType !== "working"
    ) {
      return {
        ok: false,
        reason: "memoryType must be one of shortTerm, longTerm, working",
      };
    }
    if (o.content === undefined) {
      return { ok: false, reason: "content is required" };
    }
    return { ok: true };
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as { memoryType: string; content: unknown };
    await ctx.memoryAdapter.save(scopeFromContext(ctx), o.memoryType, o.content);
    return { success: true };
  },
};

const getMemory: ToolAdapter = {
  name: "system_get_memory",
  description: "Queries stored memory fragments.",
  validate(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, reason: "input must be an object" };
    }
    const o = input as Record<string, unknown>;
    if (typeof o.memoryType !== "string") {
      return { ok: false, reason: "memoryType must be a string" };
    }
    return { ok: true };
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
    id: "system_save_memory",
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
    id: "system_get_memory",
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
