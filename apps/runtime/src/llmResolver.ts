import { AnthropicLLMAdapter } from "@opencoreagents/adapters-anthropic";
import { OpenAILLMAdapter } from "@opencoreagents/adapters-openai";
import type { LLMAdapter } from "@opencoreagents/core";
import type { ResolvedLlmStackConfig } from "./types.js";

/**
 * Build {@link AgentRuntime} LLM wiring from merged stack config (YAML / JSON).
 * Registers one adapter per provider with a non-empty API key; `defaultProvider` must be among them.
 */
export function buildLlmStackFromConfig(llm: ResolvedLlmStackConfig): {
  llmAdapter: LLMAdapter;
  llmAdaptersByProvider: Record<string, LLMAdapter>;
} {
  const map: Record<string, LLMAdapter> = {};

  const openaiKey = llm.openai.apiKey.trim();
  if (openaiKey) {
    const base = llm.openai.baseUrl.trim();
    map.openai = base ? new OpenAILLMAdapter(openaiKey, base) : new OpenAILLMAdapter(openaiKey);
  }

  const anthropicKey = llm.anthropic.apiKey.trim();
  if (anthropicKey) {
    const base = llm.anthropic.baseUrl.trim();
    map.anthropic = new AnthropicLLMAdapter(
      anthropicKey,
      base ? { baseUrl: base } : {},
    );
  }

  if (Object.keys(map).length === 0) {
    throw new Error(
      "llm: set at least one non-empty llm.openai.apiKey or llm.anthropic.apiKey (after ${…} expansion).",
    );
  }

  const def = llm.defaultProvider;
  if (def !== "openai" && def !== "anthropic") {
    throw new Error(`llm.defaultProvider must be openai or anthropic (got "${String(def)}")`);
  }
  const primary = map[def];
  if (!primary) {
    const have = Object.keys(map).join(", ");
    throw new Error(
      `llm.defaultProvider is "${def}" but that adapter is not configured. Available: ${have}. Fix config/local.yaml (or RUNTIME_CONFIG).`,
    );
  }

  return { llmAdapter: primary, llmAdaptersByProvider: map };
}
