import type { LLMAdapter } from "../adapters/llm/LLMAdapter.js";
import type { EngineConfig } from "./engineConfig.js";

/**
 * Picks the `LLMAdapter` for a run from an `AgentRuntime` config object.
 * Uses `llmAdaptersByProvider[provider]` when present, otherwise `llmAdapter`.
 */
export function resolveLlmAdapterForProvider(
  cfg: Pick<EngineConfig, "llmAdapter" | "llmAdaptersByProvider">,
  provider: string | undefined,
): LLMAdapter {
  const p = (provider ?? "").trim() || "default";
  const map = cfg.llmAdaptersByProvider;
  const mapped = map?.[p];
  if (mapped) return mapped;
  if (cfg.llmAdapter) return cfg.llmAdapter;
  throw new Error(
    `No LLM adapter for provider "${p}". Pass AgentRuntime({ llmAdapter }) and/or llmAdaptersByProvider with that key.`,
  );
}
