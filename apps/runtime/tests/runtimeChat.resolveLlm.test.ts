import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import { resolveDefaultChatAgentLlm } from "../src/runtime/runtimeChat.js";
import type { ResolvedRuntimeStackConfig } from "../src/config/types.js";

describe("resolveDefaultChatAgentLlm", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses env provider and model when set", () => {
    vi.stubEnv("RUNTIME_CHAT_AGENT_PROVIDER", "anthropic");
    vi.stubEnv("RUNTIME_CHAT_AGENT_MODEL", "claude-test");
    vi.stubEnv("RUNTIME_CHAT_AGENT_TEMPERATURE", "0.5");

    const config: ResolvedRuntimeStackConfig = {
      ...defaultStackConfig,
      llm: {
        ...defaultStackConfig.llm,
        anthropic: { apiKey: "k", baseUrl: "" },
      },
    };

    const row = resolveDefaultChatAgentLlm(config);
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe("claude-test");
    expect(row.temperature).toBe(0.5);
  });

  it("falls back to YAML chat llm model when env model is auto", () => {
    vi.stubEnv("RUNTIME_CHAT_AGENT_MODEL", "auto");
    const config: ResolvedRuntimeStackConfig = {
      ...defaultStackConfig,
      llm: {
        ...defaultStackConfig.llm,
        openai: { apiKey: "k", baseUrl: "" },
      },
      chat: {
        ...defaultStackConfig.chat,
        defaultAgent: {
          ...defaultStackConfig.chat.defaultAgent,
          llm: { model: "gpt-custom" },
        },
      },
    };
    expect(resolveDefaultChatAgentLlm(config).model).toBe("gpt-custom");
  });

  it("uses RUNTIME_DEFAULT_LLM_MODEL when chat env model is unset", () => {
    vi.stubEnv("RUNTIME_DEFAULT_LLM_MODEL", "kimi-k2.5:cloud");
    const config: ResolvedRuntimeStackConfig = {
      ...defaultStackConfig,
      llm: {
        ...defaultStackConfig.llm,
        openai: { apiKey: "k", baseUrl: "" },
      },
    };
    expect(resolveDefaultChatAgentLlm(config).model).toBe("kimi-k2.5:cloud");
  });
});
