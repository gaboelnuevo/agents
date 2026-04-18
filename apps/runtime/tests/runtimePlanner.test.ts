import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import type { ResolvedLlmStackConfig, ResolvedRuntimeStackConfig } from "../src/config/types.js";
import {
  resolveDefaultPlannerOrchestratorLlm,
  resolvePlannerSubAgentDefaultLlm,
  resolvePlannerSubAgentProvider,
} from "../src/runtime/runtimePlanner.js";

function llm(partial: Partial<ResolvedLlmStackConfig>): ResolvedLlmStackConfig {
  return {
    defaultProvider: partial.defaultProvider ?? "openai",
    openai: { apiKey: "", baseUrl: "", ...partial.openai },
    anthropic: { apiKey: "", baseUrl: "", ...partial.anthropic },
  };
}

describe("resolvePlannerSubAgentProvider", () => {
  it("returns preferred when that provider has an API key", () => {
    const cfg = llm({
      defaultProvider: "openai",
      openai: { apiKey: "sk-openai", baseUrl: "" },
      anthropic: { apiKey: "", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(cfg, "anthropic")).toBe("openai");
    const both = llm({
      defaultProvider: "openai",
      openai: { apiKey: "a", baseUrl: "" },
      anthropic: { apiKey: "b", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(both, "anthropic")).toBe("anthropic");
  });

  it("falls back to defaultProvider when preferred has no key", () => {
    const cfg = llm({
      defaultProvider: "anthropic",
      openai: { apiKey: "", baseUrl: "" },
      anthropic: { apiKey: "k", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(cfg, "openai")).toBe("anthropic");
  });

  it("picks any keyed provider when default has no key", () => {
    const onlyAnthropic = llm({
      defaultProvider: "openai",
      openai: { apiKey: "", baseUrl: "" },
      anthropic: { apiKey: "x", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(onlyAnthropic)).toBe("anthropic");

    const onlyOpenai = llm({
      defaultProvider: "anthropic",
      openai: { apiKey: "y", baseUrl: "" },
      anthropic: { apiKey: "", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(onlyOpenai)).toBe("openai");
  });

  it("returns defaultProvider when no keys are set", () => {
    const cfg = llm({
      defaultProvider: "anthropic",
      openai: { apiKey: "  ", baseUrl: "" },
      anthropic: { apiKey: "", baseUrl: "" },
    });
    expect(resolvePlannerSubAgentProvider(cfg)).toBe("anthropic");
  });
});

describe("RUNTIME_DEFAULT_LLM_MODEL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function baseConfig(): ResolvedRuntimeStackConfig {
    return {
      ...defaultStackConfig,
      llm: {
        ...defaultStackConfig.llm,
        openai: { apiKey: "k", baseUrl: "" },
      },
    };
  }

  it("applies to planner orchestrator when planner model env is unset", () => {
    vi.stubEnv("RUNTIME_DEFAULT_LLM_MODEL", "kimi-k2.5:cloud");
    expect(resolveDefaultPlannerOrchestratorLlm(baseConfig()).model).toBe("kimi-k2.5:cloud");
  });

  it("does not override explicit RUNTIME_PLANNER_AGENT_MODEL", () => {
    vi.stubEnv("RUNTIME_DEFAULT_LLM_MODEL", "kimi-k2.5:cloud");
    vi.stubEnv("RUNTIME_PLANNER_AGENT_MODEL", "gpt-4o");
    expect(resolveDefaultPlannerOrchestratorLlm(baseConfig()).model).toBe("gpt-4o");
  });

  it("applies to sub-agent defaults when RUNTIME_PLANNER_SUB_AGENT_MODEL is unset", () => {
    vi.stubEnv("RUNTIME_DEFAULT_LLM_MODEL", "kimi-k2.5:cloud");
    expect(resolvePlannerSubAgentDefaultLlm(baseConfig()).model).toBe("kimi-k2.5:cloud");
  });
});
