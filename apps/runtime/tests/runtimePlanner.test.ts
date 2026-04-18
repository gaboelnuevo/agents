import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import type { ResolvedLlmStackConfig, ResolvedRuntimeStackConfig } from "../src/config/types.js";
import {
  discoverRuntimeAvailablePlannerModels,
  resolveDefaultPlannerOrchestratorLlm,
  resolveRuntimeAvailablePlannerModels,
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
    vi.unstubAllGlobals();
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

  it("builds the available model list from resolved runtime config", () => {
    vi.stubEnv("RUNTIME_DEFAULT_LLM_MODEL", "kimi-k2.5:cloud");
    const models = resolveRuntimeAvailablePlannerModels(baseConfig());
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      provider: "openai",
      model: "kimi-k2.5:cloud",
      strengths: expect.arrayContaining(["planner default", "configured runtime model"]),
      sourceRoles: ["planner", "sub-agent"],
    });
  });

  it("includes distinct planner, sub-agent, and chat models when explicitly configured", () => {
    const cfg: ResolvedRuntimeStackConfig = {
      ...baseConfig(),
      llm: {
        defaultProvider: "openai",
        openai: { apiKey: "openai-key", baseUrl: "https://proxy.example/v1" },
        anthropic: { apiKey: "anthropic-key", baseUrl: "" },
      },
      planner: {
        defaultAgent: {
          ...defaultStackConfig.planner.defaultAgent,
          llm: { provider: "anthropic", model: "claude-custom-planner", temperature: 0.1 },
        },
        subAgent: {
          provider: "openai",
          model: "openai-custom-worker",
          temperature: 0.2,
        },
      },
      chat: {
        defaultAgent: {
          ...defaultStackConfig.chat.defaultAgent,
          llm: { provider: "openai", model: "chat-custom", temperature: 0.3 },
        },
      },
    };

    const models = resolveRuntimeAvailablePlannerModels(cfg);
    expect(models).toHaveLength(3);
    expect(models.map((m) => [m.provider, m.model])).toEqual([
      ["anthropic", "claude-custom-planner"],
      ["openai", "openai-custom-worker"],
      ["openai", "chat-custom"],
    ]);
    expect(models.map((m) => m.sourceRoles)).toEqual([
      ["planner"],
      ["sub-agent"],
      ["chat"],
    ]);
  });

  it("discovers models from the configured OpenAI-compatible endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "proxy-model-1" }, { id: "proxy-model-2" }],
        }),
      }),
    );

    const cfg: ResolvedRuntimeStackConfig = {
      ...baseConfig(),
      llm: {
        ...baseConfig().llm,
        openai: { apiKey: "k", baseUrl: "https://proxy.example/v1" },
      },
    };

    const models = await discoverRuntimeAvailablePlannerModels(cfg, "openai");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://proxy.example/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(models.map((m) => m.model)).toEqual(
      expect.arrayContaining(["proxy-model-1", "proxy-model-2", "gpt-4o", "gpt-4o-mini"]),
    );
  });

  it("falls back to configured models when remote listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const models = await discoverRuntimeAvailablePlannerModels(baseConfig(), "openai");
    expect(models.map((m) => m.model)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("discovers models from Anthropic and preserves configured source roles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "claude-custom-planner", display_name: "Planner Claude" },
            { id: "claude-fresh", display_name: "Fresh Claude" },
          ],
        }),
      }),
    );

    const cfg: ResolvedRuntimeStackConfig = {
      ...baseConfig(),
      llm: {
        defaultProvider: "anthropic",
        openai: { apiKey: "", baseUrl: "" },
        anthropic: { apiKey: "anthropic-key", baseUrl: "https://anthropic-proxy.example/v1" },
      },
      planner: {
        defaultAgent: {
          ...defaultStackConfig.planner.defaultAgent,
          llm: { provider: "anthropic", model: "claude-custom-planner", temperature: 0.1 },
        },
        subAgent: {
          provider: "anthropic",
          model: "claude-worker",
          temperature: 0.2,
        },
      },
    };

    const models = await discoverRuntimeAvailablePlannerModels(cfg, "anthropic");
    const plannerModel = models.find((m) => m.model === "claude-custom-planner");
    const freshModel = models.find((m) => m.model === "claude-fresh");
    expect(plannerModel?.sourceRoles).toEqual(["planner"]);
    expect(freshModel?.strengths).toEqual(
      expect.arrayContaining(["runtime-discovered", "provider catalog"]),
    );
  });
});
