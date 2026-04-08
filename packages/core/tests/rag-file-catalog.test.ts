import { describe, it, expect } from "vitest";
import { AgentRuntime, InMemoryMemoryAdapter, validateRagFileCatalog } from "../src/index.js";
import type { LLMAdapter, LLMRequest, LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

class DummyLlm implements LLMAdapter {
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    return { content: "{}" };
  }
}

function rt(): AgentRuntime {
  return new AgentRuntime({
    llmAdapter: new DummyLlm(),
    memoryAdapter: new InMemoryMemoryAdapter(),
  });
}

describe("AgentRuntime.registerRagCatalog", () => {
  it("validateRagFileCatalog rejects duplicate ids", () => {
    expect(() =>
      validateRagFileCatalog([
        { id: "a", description: "1", source: "1.md" },
        { id: "a", description: "2", source: "2.md" },
      ]),
    ).toThrow(/duplicate id/);
  });

  it("validateRagFileCatalog rejects missing source", () => {
    expect(() =>
      validateRagFileCatalog([{ id: "a", description: "x", source: "  " }]),
    ).toThrow(/source is required/);
  });

  it("registerRagCatalog throws on invalid entries", () => {
    const r = rt();
    expect(() =>
      r.registerRagCatalog("p1", [
        { id: "x", description: "a", source: "a.md" },
        { id: "x", description: "b", source: "b.md" },
      ]),
    ).toThrow(/duplicate id/);
  });

  it("registerRagCatalog replaces per projectId", () => {
    const r = rt();
    r.registerRagCatalog("p1", [{ id: "a", description: "A", source: "a.md" }]);
    expect(r.ragCatalogForProject("p1")).toEqual([
      { id: "a", description: "A", source: "a.md" },
    ]);
    r.registerRagCatalog("p1", [{ id: "b", description: "B", source: "b.md" }]);
    expect(r.ragCatalogForProject("p1")).toEqual([
      { id: "b", description: "B", source: "b.md" },
    ]);
  });

  it("ragCatalogForProject is undefined for unregistered project", () => {
    expect(rt().ragCatalogForProject("unknown")).toBeUndefined();
  });

  it("allows empty catalog for a project (no fallback to global)", () => {
    const r = rt();
    r.registerRagCatalog("p-empty", []);
    expect(r.ragCatalogForProject("p-empty")).toEqual([]);
  });

  it("throws when projectId is blank", () => {
    expect(() => rt().registerRagCatalog("  ", [])).toThrow(/projectId is required/);
  });
});
