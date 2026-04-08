import { describe, it, expect } from "vitest";
import { InMemoryMemoryAdapter } from "../src/adapters/memory/InMemoryMemoryAdapter.js";
import { AgentRuntime } from "../src/runtime/AgentRuntime.js";
import { resolveLlmAdapterForProvider } from "../src/runtime/resolveLlmAdapter.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

function tagLlm(tag: string): LLMAdapter {
  return {
    async generate(_req: LLMRequest): Promise<LLMResponse> {
      return { content: JSON.stringify({ type: "result", content: tag }) };
    },
  };
}

describe("resolveLlmAdapterForProvider", () => {
  it("uses llmAdaptersByProvider when provider key matches", () => {
    const openai = tagLlm("openai");
    const other = tagLlm("fallback");
    const picked = resolveLlmAdapterForProvider(
      {
        llmAdapter: other,
        llmAdaptersByProvider: { openai },
      },
      "openai",
    );
    expect(picked).toBe(openai);
  });

  it("falls back to llmAdapter when provider not in map", () => {
    const fallback = tagLlm("fallback");
    const picked = resolveLlmAdapterForProvider(
      {
        llmAdapter: fallback,
        llmAdaptersByProvider: { openai: tagLlm("openai") },
      },
      "anthropic",
    );
    expect(picked).toBe(fallback);
  });

  it("uses default key when provider is empty", () => {
    const def = tagLlm("default-key");
    const picked = resolveLlmAdapterForProvider(
      {
        llmAdaptersByProvider: { default: def },
      },
      "",
    );
    expect(picked).toBe(def);
  });

  it("throws when no adapter available", () => {
    expect(() =>
      resolveLlmAdapterForProvider({ llmAdaptersByProvider: { openai: tagLlm("x") } }, "missing"),
    ).toThrow(/No LLM adapter for provider/);
  });
});

describe("AgentRuntime LLM validation", () => {
  it("rejects config with no llmAdapter and no llmAdaptersByProvider", () => {
    expect(
      () =>
        new AgentRuntime({
          memoryAdapter: new InMemoryMemoryAdapter(),
        }),
    ).toThrow(/llmAdapter/);
  });

  it("accepts only llmAdaptersByProvider", () => {
    expect(
      () =>
        new AgentRuntime({
          memoryAdapter: new InMemoryMemoryAdapter(),
          llmAdaptersByProvider: { openai: tagLlm("ok") },
        }),
    ).not.toThrow();
  });
});
