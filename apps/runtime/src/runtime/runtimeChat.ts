import type { DynamicDefinitionsStore } from "@opencoreagents/dynamic-definitions";
import type { AgentDefinitionPersisted } from "@opencoreagents/core";
import type { LlmDriverKind, ResolvedRuntimeStackConfig } from "../config/types.js";
import { readRuntimeDefaultLlmModelEnv } from "./runtimeDefaultLlmModelEnv.js";
import { resolvePlannerSubAgentProvider } from "./runtimePlanner.js";
import { RUNTIME_FETCH_RUN_TOOL_ID } from "./fetchRunTool.js";
import { RUNTIME_INVOKE_PLANNER_TOOL_ID } from "./invokePlannerTool.js";

/** Same strength tier as the default planner orchestrator — good default for a front-line chat agent. */
const FALLBACK_CHAT_AGENT_MODEL: Record<LlmDriverKind, string> = {
  openai: "gpt-4o",
  anthropic: "claude-opus-4-6",
};

export const DEFAULT_CHAT_AGENT_TOOL_IDS: readonly string[] = [
  RUNTIME_INVOKE_PLANNER_TOOL_ID,
  RUNTIME_FETCH_RUN_TOOL_ID,
  "system_save_memory",
  "system_get_memory",
  "system_send_message",
];

export function chatAgentToolIds(config: ResolvedRuntimeStackConfig): string[] {
  return config.artifacts.enabled
    ? [...DEFAULT_CHAT_AGENT_TOOL_IDS, "system_write_artifact"]
    : [...DEFAULT_CHAT_AGENT_TOOL_IDS];
}

export const DEFAULT_CHAT_SYSTEM_PROMPT = `You are a helpful assistant for end users.

- Answer directly when you can.
- For multi-step planning, research, or work that should use the dynamic planner (**spawn_agent** / sub-agents), call **invoke_planner** with a clear **goal**. That run is asynchronous; do not claim the planner has finished in the same turn.
- When the user sends a **follow-up message** and you previously returned a planner **runId**, call **runtime_fetch_run** with that **runId** to load **status** and **reply** from the server and answer from that data (no separate event stream required). If still **running**/**waiting**, say so briefly.
- If the user asks for **status** or **progress** on the planner (e.g. “¿cómo va?”, “is it done?”), call **runtime_fetch_run once**: **omit** **runId** to use the **last** **invoke_planner** id from this run’s persisted history, or pass the **runId** if the user included it. Prefer echoing **statusSummary** when they only asked for status. If **status** is **running** or **waiting**, answer **immediately** with that fact — do **not** wait for the planner to finish in this turn, do **not** call **invoke_planner** again for that check, and do **not** imply you will only reply after completion. End the turn with a **result** step in the same cycle (e.g. “sigue en proceso / running”) — the background planner job may still be running; that is expected and fine.
- **Planner discipline:** call **invoke_planner at most once** per distinct user goal in this turn. To retry or check progress, use **runtime_fetch_run** on the **same planner run id** — never fire many **invoke_planner** calls in a row (that exhausts the engine step budget and wastes queue jobs). If **runtime_fetch_run** shows **failed**, still answer neutrally for a status-only question: state **status** + short reason (use **statusSummary**); do **not** use catastrophic framing as if the user’s question failed. Offer deeper troubleshooting or **hint** details only if they ask how to fix or improve. Then end with a **result** step; only call **invoke_planner** again if the **user** explicitly asks for a new attempt.
- **Memory discipline:** **system_get_memory** with the same arguments **at most once** per user question — if the observation already returned rows, summarize and end with a **result** step; do not loop identical reads.
- Keep replies concise unless the user asks for detail.`;

function isDefaultChatAgentDisabledByEnv(): boolean {
  const v = process.env.RUNTIME_CHAT_DEFAULT_AGENT?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

/**
 * LLM row for the default **chat** agent. Env: **`RUNTIME_CHAT_AGENT_PROVIDER`**, **`RUNTIME_CHAT_AGENT_MODEL`**, **`RUNTIME_CHAT_AGENT_TEMPERATURE`** (same **`auto`** rules as the planner orchestrator). **`RUNTIME_DEFAULT_LLM_MODEL`** applies when the chat model env is unset/`auto` and YAML has no model.
 */
export function resolveDefaultChatAgentLlm(config: ResolvedRuntimeStackConfig): {
  provider: LlmDriverKind;
  model: string;
  temperature: number;
} {
  const llm = config.llm;
  const d = config.chat.defaultAgent.llm;

  const envProvRaw = process.env.RUNTIME_CHAT_AGENT_PROVIDER?.trim().toLowerCase();
  let yamlOrEnvProvider: LlmDriverKind | undefined = d.provider;
  if (envProvRaw && envProvRaw !== "auto") {
    if (envProvRaw === "openai" || envProvRaw === "anthropic") {
      yamlOrEnvProvider = envProvRaw;
    }
  }

  const provider = resolvePlannerSubAgentProvider(llm, yamlOrEnvProvider);

  const envModelRaw = process.env.RUNTIME_CHAT_AGENT_MODEL?.trim();
  const envModel =
    envModelRaw && envModelRaw.length > 0 && envModelRaw.toLowerCase() !== "auto"
      ? envModelRaw
      : undefined;
  const defaultModelEnv = readRuntimeDefaultLlmModelEnv();
  const model =
    envModel ??
    defaultModelEnv ??
    (d.model && d.model.length > 0 ? d.model : undefined) ??
    FALLBACK_CHAT_AGENT_MODEL[provider];

  const envTempRaw = process.env.RUNTIME_CHAT_AGENT_TEMPERATURE?.trim();
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

export async function writeDefaultChatAgentToStore(
  store: DynamicDefinitionsStore,
  projectId: string,
  config: ResolvedRuntimeStackConfig,
): Promise<void> {
  const { id } = config.chat.defaultAgent;
  const { provider, model, temperature } = resolveDefaultChatAgentLlm(config);

  const plannerId = config.planner.defaultAgent.id;
  const busNote =
    `\n\nMESSAGE BUS: **system_send_message** targets other agents via the shared Redis bus (stream **bus:agent:<targetId>**). ` +
    `The planner (**${plannerId}**) may publish **event** messages to you (**${id}**) for telemetry; they are not auto-injected into this chat — ` +
    `rely on **runtime_fetch_run** / SSE unless your client consumes the bus.`;

  const agent: AgentDefinitionPersisted = {
    id,
    projectId,
    systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT + busNote,
    tools: chatAgentToolIds(config),
    llm: { provider, model, temperature },
    memoryConfig: {
      shortTerm: { maxTurns: 40 },
      working: {},
      longTerm: true,
    },
  };

  await store.Agent.define(agent);
}

/**
 * Ensures the stack’s default **chat** agent exists — intended for the **first** **`POST /v1/chat`** (lazy create).
 */
export async function ensureDefaultChatAgentOnFirstChat(options: {
  store: DynamicDefinitionsStore;
  projectId: string;
  config: ResolvedRuntimeStackConfig;
}): Promise<{ created: boolean; id: string }> {
  const { id } = options.config.chat.defaultAgent;
  if (!options.config.chat.defaultAgent.enabled || isDefaultChatAgentDisabledByEnv()) {
    return { created: false, id };
  }

  const agents = await options.store.methods.listAgents(options.projectId);
  if (agents.some((a) => a.id === id)) {
    return { created: false, id };
  }

  await writeDefaultChatAgentToStore(options.store, options.projectId, options.config);
  return { created: true, id };
}

export function isChatEndpointAvailable(config: ResolvedRuntimeStackConfig): boolean {
  return config.chat.defaultAgent.enabled && !isDefaultChatAgentDisabledByEnv();
}
