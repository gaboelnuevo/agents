/**
 * Single env fallback for default seeded agents (planner orchestrator, planner sub-agents, chat)
 * when their role-specific `RUNTIME_*_MODEL` is unset or `auto` and YAML does not pin a model.
 */
export function readRuntimeDefaultLlmModelEnv(): string | undefined {
  const raw = process.env.RUNTIME_DEFAULT_LLM_MODEL?.trim();
  if (!raw || raw.toLowerCase() === "auto") {
    return undefined;
  }
  return raw;
}
