import type { AgentDefinitionPersisted } from "./types.js";
import { getSkillDefinition } from "./registry.js";

/** Tools from the agent plus tools contributed by attached skills (same rules as `RunBuilder`). */
export function effectiveToolAllowlist(
  agent: AgentDefinitionPersisted,
  projectId: string,
): Set<string> {
  const s = new Set(agent.tools ?? []);
  for (const sid of agent.skills ?? []) {
    const sk = getSkillDefinition(projectId, sid);
    if (sk) for (const t of sk.tools) s.add(t);
  }
  return s;
}

/**
 * Applies an optional per-runtime tool allowlist (`EngineConfig.allowedToolIds`).
 * `undefined` or `"*"` leaves `agentTools` unchanged; otherwise returns the intersection.
 */
export function applyRuntimeToolAllowlist(
  agentTools: Set<string>,
  runtimeAllowed?: ReadonlySet<string> | readonly string[] | "*",
): Set<string> {
  if (runtimeAllowed == null || runtimeAllowed === "*") {
    return new Set(agentTools);
  }
  const rt =
    runtimeAllowed instanceof Set ? runtimeAllowed : new Set(runtimeAllowed);
  return new Set([...agentTools].filter((id) => rt.has(id)));
}
