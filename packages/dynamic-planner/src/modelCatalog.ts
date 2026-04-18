export type PlannerModelTier = "flagship" | "balanced" | "fast";

export type PlannerCostRelative = "high" | "medium" | "low";

export interface PlannerModelEntry {
  provider: string;
  model: string;
  alias: string;
  tier: PlannerModelTier;
  costRelative: PlannerCostRelative;
  contextWindow: number;
  strengths: string[];
  recommended: string[];
  avoid: string[];
  sourceRoles?: string[];
}

/**
 * Optional example catalog for `list_available_models`.
 *
 * This package does not assume these ids exist in your deployment. If you use a custom endpoint,
 * proxy, or self-hosted adapter, prefer `registerDynamicPlannerTools({ resolveAvailableModels })`
 * or pass your own `modelCatalog`.
 */
export const DEFAULT_PLANNER_MODEL_CATALOG: readonly PlannerModelEntry[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-6",
    alias: "opus",
    tier: "flagship",
    costRelative: "high",
    contextWindow: 1_000_000,
    strengths: ["complex reasoning", "planning", "agents", "long-context analysis", "advanced code"],
    recommended: ["multi-step planning", "quality evaluation", "complex synthesis", "Planner default"],
    avoid: ["simple repetitive tasks", "high-frequency calls"],
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    alias: "sonnet",
    tier: "balanced",
    costRelative: "medium",
    contextWindow: 1_000_000,
    strengths: ["speed/intelligence balance", "code", "data analysis", "writing", "tool use"],
    recommended: ["most sub-agents", "data analysis", "text generation", "orchestration support"],
    avoid: ["hardest reasoning where Opus is materially better"],
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    alias: "haiku",
    tier: "fast",
    costRelative: "low",
    contextWindow: 200_000,
    strengths: ["latency", "cost", "classification", "structured extraction", "routing"],
    recommended: ["format validation", "classification", "simple transforms", "high-frequency sub-agents"],
    avoid: ["complex reasoning", "long-form synthesis"],
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    alias: "gpt5.4",
    tier: "flagship",
    costRelative: "high",
    contextWindow: 1_000_000,
    strengths: ["frontier reasoning", "coding", "multimodal (vision)", "tool use", "long context"],
    recommended: ["hardest OpenAI tasks", "vision-heavy work", "complex code"],
    avoid: ["trivial tasks where mini/nano suffices"],
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    alias: "gpt5.4-mini",
    tier: "balanced",
    costRelative: "medium",
    contextWindow: 400_000,
    strengths: ["strong mini model", "coding", "agents", "lower cost than gpt-5.4"],
    recommended: ["default OpenAI sub-agents", "tool-heavy workflows", "analysis"],
    avoid: ["frontier-only problems"],
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    alias: "gpt5.4-nano",
    tier: "fast",
    costRelative: "low",
    contextWindow: 400_000,
    strengths: ["lowest cost GPT-5.4 class", "speed", "classification", "extraction"],
    recommended: ["high-volume transforms", "entity extraction", "cheap sub-agents"],
    avoid: ["hard reasoning", "long synthesis"],
  },
];

export const DEFAULT_MODEL_SELECTION_GUIDE: Readonly<Record<string, string>> = {
  "reasoning and planning": "claude-opus-4-6 or gpt-5.4",
  "data analysis / code": "claude-sonnet-4-6 or gpt-5.4-mini",
  "classification / validation": "claude-haiku-4-5 or gpt-5.4-nano",
  "image-heavy tasks": "gpt-5.4 or claude-opus-4-6",
  "high-frequency transforms": "claude-haiku-4-5 or gpt-5.4-nano",
};

export function filterPlannerModelsByProvider(
  catalog: readonly PlannerModelEntry[],
  provider?: string,
): PlannerModelEntry[] {
  const normalized = provider?.trim().toLowerCase();
  if (!normalized || normalized === "all") return [...catalog];
  return catalog.filter((m) => m.provider.trim().toLowerCase() === normalized);
}
