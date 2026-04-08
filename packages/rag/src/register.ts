import { Tool, Skill } from "@agent-runtime/core";
import { getRagRegistrations } from "./registrations.js";

/**
 * Registers all RAG tool definitions/handlers and skills in the core in-process registry.
 * Call once at process startup after `configureRuntime` if you use RAG tools.
 */
export async function registerRagToolsAndSkills(): Promise<void> {
  const { tools, skills } = getRagRegistrations();
  for (const t of tools) {
    await Tool.define({
      ...t.definition,
      execute: (input, ctx) => t.handler.execute(input, ctx),
    });
  }
  for (const s of skills) {
    await Skill.define(s);
  }
}
