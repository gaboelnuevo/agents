import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import {
  DEFAULT_PLANNER_SYSTEM_PROMPT,
  registerDynamicPlannerTools,
  type PlannerModelEntry,
  type PlannerEnqueueRun,
} from "@opencoreagents/dynamic-planner";
import type { AgentDefinitionPersisted, RunStore } from "@opencoreagents/core";
import type { LlmDriverKind, ResolvedLlmStackConfig, ResolvedRuntimeStackConfig } from "../config/types.js";
import { readRuntimeDefaultLlmModelEnv } from "./runtimeDefaultLlmModelEnv.js";

/**
 * When `spawn_agent` does not pass `llm`, these ids are used. Kept **conservative** so they work on
 * standard APIs and many OpenAI-compatible gateways; override via `planner.subAgent` in the stack
 * or `RUNTIME_PLANNER_SUB_AGENT_*` env if you use other model names (or newer SKUs).
 */
const FALLBACK_SUB_AGENT_MODEL: Record<LlmDriverKind, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
};

/** Orchestrator (planner) defaults when `planner.defaultAgent.llm` is omitted — stronger than sub-agent fallbacks. */
const FALLBACK_PLANNER_ORCHESTRATOR_MODEL: Record<LlmDriverKind, string> = {
  openai: "gpt-4o",
  anthropic: "claude-opus-4-6",
};

/** Tool ids for the seeded planner agent row (matches {@link registerDynamicPlannerTools} + memory). */
export const DEFAULT_PLANNER_AGENT_TOOL_IDS: readonly string[] = [
  "spawn_agent",
  "wait_for_agents",
  "reflect_and_retry",
  "list_available_tools",
  "list_available_models",
  "system_save_memory",
  "system_get_memory",
  "system_send_message",
];

export function plannerAgentToolIds(config: ResolvedRuntimeStackConfig): string[] {
  return config.artifacts.enabled
    ? [...DEFAULT_PLANNER_AGENT_TOOL_IDS, "system_write_artifact"]
    : [...DEFAULT_PLANNER_AGENT_TOOL_IDS];
}

function pushConfiguredModelEntry(
  entries: PlannerModelEntry[],
  seen: Set<string>,
  entry: PlannerModelEntry,
): void {
  const key = `${entry.provider}\u0000${entry.model}`;
  if (seen.has(key)) {
    const existing = entries.find((item) => item.provider === entry.provider && item.model === entry.model);
    if (existing && entry.sourceRoles?.length) {
      const merged = new Set([...(existing.sourceRoles ?? []), ...entry.sourceRoles]);
      existing.sourceRoles = [...merged];
    }
    return;
  }
  seen.add(key);
  entries.push(entry);
}

function aliasFromModel(model: string): string {
  return model.trim() || "configured-model";
}

function openaiBaseUrl(config: ResolvedRuntimeStackConfig): string {
  return (config.llm.openai.baseUrl.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}

function anthropicBaseUrl(config: ResolvedRuntimeStackConfig): string {
  return (config.llm.anthropic.baseUrl.trim() || "https://api.anthropic.com/v1").replace(/\/$/, "");
}

function hasProviderApiKey(llm: ResolvedLlmStackConfig, provider: LlmDriverKind): boolean {
  const key = provider === "openai" ? llm.openai.apiKey : llm.anthropic.apiKey;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Pick which adapter sub-agents use when the stack does not pin `planner.subAgent.provider`:
 * explicit preference if that provider has a key, else `defaultProvider` if keyed, else the only keyed provider.
 */
export function resolvePlannerSubAgentProvider(
  llm: ResolvedLlmStackConfig,
  preferred?: LlmDriverKind,
): LlmDriverKind {
  if (preferred && hasProviderApiKey(llm, preferred)) {
    return preferred;
  }
  const def = llm.defaultProvider;
  if (hasProviderApiKey(llm, def)) {
    return def;
  }
  if (hasProviderApiKey(llm, "openai")) {
    return "openai";
  }
  if (hasProviderApiKey(llm, "anthropic")) {
    return "anthropic";
  }
  return def;
}

/**
 * Resolves `defaultSubAgentLlm` for {@link registerDynamicPlannerTools}.
 *
 * - **Provider:** YAML `planner.subAgent.provider`, or env `RUNTIME_PLANNER_SUB_AGENT_PROVIDER`. Use **`auto`** or omit to infer from API keys + `llm.defaultProvider`.
 * - **Model:** env `RUNTIME_PLANNER_SUB_AGENT_MODEL`, else `RUNTIME_DEFAULT_LLM_MODEL`, else YAML `planner.subAgent.model`. Use **`auto`** or omit (after those) to use {@link FALLBACK_SUB_AGENT_MODEL} for the resolved provider.
 * - **Temperature:** env `RUNTIME_PLANNER_SUB_AGENT_TEMPERATURE` (number), else YAML `planner.subAgent.temperature`, else `0.2`.
 *
 * **Custom endpoint:** `llm.openai.baseUrl` / `llm.anthropic.baseUrl` are applied in **`buildLlmStackFromConfig`**
 * (`llmResolver.ts`) when constructing the worker’s `AgentRuntime`. Sub-agent rows in Redis only store `provider` + `model`; at run
 * time the engine picks the adapter for that `provider`, so **the same base URL and API key** are used as for any
 * other agent. You do **not** duplicate the URL under `planner`. If the gateway uses different model ids than the
 * public APIs, set `planner.subAgent.model` or `RUNTIME_PLANNER_SUB_AGENT_MODEL` explicitly.
 */
export function resolvePlannerSubAgentDefaultLlm(
  config: ResolvedRuntimeStackConfig,
): {
  provider: string;
  model: string;
  temperature?: number;
} {
  const llm = config.llm;
  const sub = config.planner.subAgent;

  const envProvRaw = process.env.RUNTIME_PLANNER_SUB_AGENT_PROVIDER?.trim().toLowerCase();
  let yamlOrEnvProvider: LlmDriverKind | undefined = sub.provider;
  if (envProvRaw && envProvRaw !== "auto") {
    if (envProvRaw === "openai" || envProvRaw === "anthropic") {
      yamlOrEnvProvider = envProvRaw;
    }
  }

  const provider = resolvePlannerSubAgentProvider(llm, yamlOrEnvProvider);

  const envModelRaw = process.env.RUNTIME_PLANNER_SUB_AGENT_MODEL?.trim();
  const envModel =
    envModelRaw && envModelRaw.length > 0 && envModelRaw.toLowerCase() !== "auto"
      ? envModelRaw
      : undefined;
  const defaultModelEnv = readRuntimeDefaultLlmModelEnv();
  const model =
    envModel ??
    defaultModelEnv ??
    (sub.model && sub.model.length > 0 ? sub.model : undefined) ??
    FALLBACK_SUB_AGENT_MODEL[provider];

  const envTempRaw = process.env.RUNTIME_PLANNER_SUB_AGENT_TEMPERATURE?.trim();
  let temperature = sub.temperature;
  if (envTempRaw !== undefined && envTempRaw !== "") {
    const n = Number(envTempRaw);
    if (Number.isFinite(n)) {
      temperature = n;
    }
  }

  return {
    provider,
    model,
    temperature: temperature ?? 0.2,
  };
}

function isDefaultPlannerAgentDisabledByEnv(): boolean {
  const v = process.env.RUNTIME_PLANNER_DEFAULT_AGENT?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

/**
 * LLM for the **orchestrator** agent row (`planner.defaultAgent`), not sub-agents.
 * Env: `RUNTIME_PLANNER_AGENT_PROVIDER`, `RUNTIME_PLANNER_AGENT_MODEL`, `RUNTIME_PLANNER_AGENT_TEMPERATURE` (same `auto` rules as sub-agent envs). Model also falls back to `RUNTIME_DEFAULT_LLM_MODEL` when the planner-specific model env is unset/`auto` and YAML has no model.
 */
export function resolveDefaultPlannerOrchestratorLlm(
  config: ResolvedRuntimeStackConfig,
): {
  provider: LlmDriverKind;
  model: string;
  temperature: number;
} {
  const llm = config.llm;
  const d = config.planner.defaultAgent.llm;

  const envProvRaw = process.env.RUNTIME_PLANNER_AGENT_PROVIDER?.trim().toLowerCase();
  let yamlOrEnvProvider: LlmDriverKind | undefined = d.provider;
  if (envProvRaw && envProvRaw !== "auto") {
    if (envProvRaw === "openai" || envProvRaw === "anthropic") {
      yamlOrEnvProvider = envProvRaw;
    }
  }

  const provider = resolvePlannerSubAgentProvider(llm, yamlOrEnvProvider);

  const envModelRaw = process.env.RUNTIME_PLANNER_AGENT_MODEL?.trim();
  const envModel =
    envModelRaw && envModelRaw.length > 0 && envModelRaw.toLowerCase() !== "auto"
      ? envModelRaw
      : undefined;
  const defaultModelEnv = readRuntimeDefaultLlmModelEnv();
  const model =
    envModel ??
    defaultModelEnv ??
    (d.model && d.model.length > 0 ? d.model : undefined) ??
    FALLBACK_PLANNER_ORCHESTRATOR_MODEL[provider];

  const envTempRaw = process.env.RUNTIME_PLANNER_AGENT_TEMPERATURE?.trim();
  let temperature = d.temperature;
  if (envTempRaw !== undefined && envTempRaw !== "") {
    const n = Number(envTempRaw);
    if (Number.isFinite(n)) {
      temperature = n;
    }
  }

  return {
    provider,
    model,
    temperature: temperature ?? 0.2,
  };
}

/**
 * Runtime-backed catalog for `list_available_models`.
 *
 * This reflects models actually configured or inferred by the current stack instead of assuming
 * public provider catalogs. It is safe for OpenAI-compatible proxies and custom endpoints because
 * every returned id comes from local runtime config/env resolution.
 */
export function resolveRuntimeAvailablePlannerModels(
  config: ResolvedRuntimeStackConfig,
): PlannerModelEntry[] {
  const out: PlannerModelEntry[] = [];
  const seen = new Set<string>();

  const planner = resolveDefaultPlannerOrchestratorLlm(config);
  pushConfiguredModelEntry(out, seen, {
    provider: planner.provider,
    model: planner.model,
    alias: aliasFromModel(planner.model),
    tier: "flagship",
    costRelative: "high",
    contextWindow: 0,
    strengths: ["planner default", "configured runtime model"],
    recommended: ["planner orchestration", "hardest evaluation steps"],
    avoid: [],
    sourceRoles: ["planner"],
  });

  const subAgent = resolvePlannerSubAgentDefaultLlm(config);
  pushConfiguredModelEntry(out, seen, {
    provider: subAgent.provider,
    model: subAgent.model,
    alias: aliasFromModel(subAgent.model),
    tier: "balanced",
    costRelative: "medium",
    contextWindow: 0,
    strengths: ["sub-agent default", "configured runtime model"],
    recommended: ["default explicit override for spawned agents"],
    avoid: [],
    sourceRoles: ["sub-agent"],
  });

  const chat = config.chat.defaultAgent.llm;
  if (chat.provider && chat.model) {
    pushConfiguredModelEntry(out, seen, {
      provider: chat.provider,
      model: chat.model,
      alias: aliasFromModel(chat.model),
      tier: "balanced",
      costRelative: "medium",
      contextWindow: 0,
      strengths: ["chat default", "configured runtime model"],
      recommended: ["chat-oriented orchestration flows"],
      avoid: [],
      sourceRoles: ["chat"],
    });
  }

  return out;
}

async function discoverOpenAiModels(config: ResolvedRuntimeStackConfig): Promise<PlannerModelEntry[]> {
  const apiKey = config.llm.openai.apiKey.trim();
  if (!apiKey) return [];

  const res = await fetch(`${openaiBaseUrl(config)}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI model discovery failed with HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ id?: unknown; created?: unknown }>;
  };
  const out: PlannerModelEntry[] = [];
  for (const item of body.data ?? []) {
    const model = typeof item.id === "string" ? item.id.trim() : "";
    if (!model) continue;
    out.push({
      provider: "openai",
      model,
      alias: aliasFromModel(model),
      tier: "balanced",
      costRelative: "medium",
      contextWindow: 0,
      strengths: ["runtime-discovered", "provider catalog"],
      recommended: [],
      avoid: [],
    });
  }
  return out;
}

async function discoverAnthropicModels(
  config: ResolvedRuntimeStackConfig,
): Promise<PlannerModelEntry[]> {
  const apiKey = config.llm.anthropic.apiKey.trim();
  if (!apiKey) return [];

  const res = await fetch(`${anthropicBaseUrl(config)}/models`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic model discovery failed with HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ id?: unknown; display_name?: unknown }>;
  };
  const out: PlannerModelEntry[] = [];
  for (const item of body.data ?? []) {
    const model = typeof item.id === "string" ? item.id.trim() : "";
    if (!model) continue;
    const displayName =
      typeof item.display_name === "string" && item.display_name.trim()
        ? item.display_name.trim()
        : model;
    out.push({
      provider: "anthropic",
      model,
      alias: aliasFromModel(displayName),
      tier: "balanced",
      costRelative: "medium",
      contextWindow: 0,
      strengths: ["runtime-discovered", "provider catalog"],
      recommended: [],
      avoid: [],
    });
  }
  return out;
}

function mergeDiscoveredAndConfiguredModels(
  configured: readonly PlannerModelEntry[],
  discovered: readonly PlannerModelEntry[],
): PlannerModelEntry[] {
  const out: PlannerModelEntry[] = [];
  const seen = new Set<string>();
  for (const entry of configured) {
    pushConfiguredModelEntry(out, seen, { ...entry, sourceRoles: [...(entry.sourceRoles ?? [])] });
  }
  for (const entry of discovered) {
    pushConfiguredModelEntry(out, seen, { ...entry, sourceRoles: [...(entry.sourceRoles ?? [])] });
  }
  return out;
}

export async function discoverRuntimeAvailablePlannerModels(
  config: ResolvedRuntimeStackConfig,
  provider?: string,
): Promise<PlannerModelEntry[]> {
  const normalized = provider?.trim().toLowerCase();
  const configured = resolveRuntimeAvailablePlannerModels(config);
  const wantOpenai = !normalized || normalized === "all" || normalized === "openai";
  const wantAnthropic = !normalized || normalized === "all" || normalized === "anthropic";

  const discovered: PlannerModelEntry[] = [];
  try {
    if (wantOpenai) {
      discovered.push(...(await discoverOpenAiModels(config)));
    }
  } catch {
    // Fall back to locally resolved models when the endpoint does not expose /models or rejects listing.
  }
  try {
    if (wantAnthropic) {
      discovered.push(...(await discoverAnthropicModels(config)));
    }
  } catch {
    // Fall back to locally resolved models when the endpoint does not expose /models or rejects listing.
  }

  const filteredConfigured =
    !normalized || normalized === "all"
      ? configured
      : configured.filter((entry) => entry.provider.toLowerCase() === normalized);

  return mergeDiscoveredAndConfiguredModels(filteredConfigured, discovered);
}

/** Writes the stack's default planner row (same shape as boot seed). Does not check if it already exists. */
export async function writeDefaultPlannerAgentToStore(
  store: DynamicDefinitionsStore,
  projectId: string,
  config: ResolvedRuntimeStackConfig,
): Promise<void> {
  const { id } = config.planner.defaultAgent;
  const { provider, model, temperature } = resolveDefaultPlannerOrchestratorLlm(config);

  const chatId = config.chat.defaultAgent.id;
  const busNote =
    `\n\nMESSAGE BUS: For chat-driven runs, you may send sparse **event** messages to **${chatId}** via **system_send_message** ` +
    `(payload e.g. milestone text or structured progress). Use Redis stream **bus:agent:${chatId}** semantics; do not flood.`;

  const agent: AgentDefinitionPersisted = {
    id,
    projectId,
    systemPrompt: DEFAULT_PLANNER_SYSTEM_PROMPT + busNote,
    tools: plannerAgentToolIds(config),
    llm: { provider, model, temperature },
    memoryConfig: {
      shortTerm: { maxTurns: 60 },
      working: {},
      longTerm: true,
    },
  };

  await store.Agent.define(agent);
}

/**
 * Ensures the target planner agent exists for **`invoke_planner`** before enqueueing.
 *
 * - If **`targetPlannerAgentId`** matches **`planner.defaultAgent.id`** and the row is missing, creates it when
 *   seeding is allowed (same rules as {@link ensureDefaultPlannerAgent}).
 * - If a **custom** `plannerAgentId` was passed and the row is missing, throws (no template to invent a row).
 */
export async function ensurePlannerAgentExistsForInvoke(options: {
  store: DynamicDefinitionsStore;
  projectId: string;
  config: ResolvedRuntimeStackConfig;
  targetPlannerAgentId: string;
}): Promise<void> {
  const { id: defaultId } = options.config.planner.defaultAgent;
  const agents = await options.store.methods.listAgents(options.projectId);
  if (agents.some((a) => a.id === options.targetPlannerAgentId)) {
    return;
  }

  if (options.targetPlannerAgentId !== defaultId) {
    throw new Error(
      `invoke_planner: agent '${options.targetPlannerAgentId}' is not defined for project ${options.projectId}. ` +
        `Create it via PUT /v1/agents/... or omit plannerAgentId to use the default planner '${defaultId}'.`,
    );
  }

  if (!options.config.planner.defaultAgent.enabled || isDefaultPlannerAgentDisabledByEnv()) {
    throw new Error(
      `invoke_planner: default planner agent '${defaultId}' is missing and automatic creation is disabled ` +
        `(enable planner.defaultAgent or unset RUNTIME_PLANNER_DEFAULT_AGENT=off).`,
    );
  }

  await writeDefaultPlannerAgentToStore(options.store, options.projectId, options.config);
}

/**
 * If enabled in config (and not disabled by env), creates the planner agent in Redis when missing.
 * Idempotent — safe on every **server** and **worker** boot (same Redis).
 */
export async function ensureDefaultPlannerAgent(options: {
  store: DynamicDefinitionsStore;
  projectId: string;
  config: ResolvedRuntimeStackConfig;
}): Promise<{ created: boolean; id: string }> {
  const { id } = options.config.planner.defaultAgent;
  if (!options.config.planner.defaultAgent.enabled || isDefaultPlannerAgentDisabledByEnv()) {
    return { created: false, id };
  }

  const agents = await options.store.methods.listAgents(options.projectId);
  if (agents.some((a) => a.id === id)) {
    return { created: false, id };
  }

  await writeDefaultPlannerAgentToStore(options.store, options.projectId, options.config);
  return { created: true, id };
}

/**
 * Registers global planner tools (`spawn_agent`, `wait_for_agents`, …) for this process.
 * Call on **server** (validation + optional run HTTP) and **worker** (execution) before handling traffic.
 */
export async function registerRuntimeDynamicPlanner(options: {
  definitionsStore: DynamicDefinitionsStore;
  runStore: RunStore;
  enqueueRun: PlannerEnqueueRun;
  config: ResolvedRuntimeStackConfig;
}): Promise<void> {
  await registerDynamicPlannerTools({
    definitionsStore: options.definitionsStore,
    runStore: options.runStore,
    enqueueRun: options.enqueueRun,
    defaultSubAgentLlm: resolvePlannerSubAgentDefaultLlm(options.config),
    resolveAvailableModels: async ({ provider }) => {
      return discoverRuntimeAvailablePlannerModels(options.config, provider);
    },
  });
}
