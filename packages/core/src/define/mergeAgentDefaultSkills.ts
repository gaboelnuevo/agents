import type { AgentDefinitionPersisted } from "./types.js";

/**
 * Prepends runtime `defaultSkillIdsGlobal`, then the agent's `skills`, deduping (first wins).
 */
export function mergeAgentDefinitionWithRuntimeDefaultSkills(
  def: AgentDefinitionPersisted,
  defaultSkillIdsGlobal?: readonly string[],
): AgentDefinitionPersisted {
  const global = defaultSkillIdsGlobal;
  if (!global?.length) return def;

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of global) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of def.skills ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return { ...def, skills: merged };
}
