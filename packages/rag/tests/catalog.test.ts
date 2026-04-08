import { describe, it, beforeEach, expect } from "vitest";
import {
  AgentRuntime,
  InMemoryMemoryAdapter,
  type LLMAdapter,
  type LLMRequest,
  type LLMResponse,
} from "@agent-runtime/core";
import {
  registerRagCatalog,
  registerRagFileCatalog,
  getRagFileCatalog,
  getRagSourceById,
  resolveRagCatalog,
  __resetRagFileCatalogForTests,
} from "../src/catalog.js";
import { listRagSourcesTool } from "../src/tools/listRagSources.js";
import { ingestRagSourceTool } from "../src/tools/ingestRagSource.js";
import type { ToolContext } from "@agent-runtime/core";

describe("RAG file catalog", () => {
  beforeEach(() => {
    __resetRagFileCatalogForTests();
  });

  it("registerRagFileCatalog replaces entries", () => {
    registerRagFileCatalog([
      { id: "a", description: "A doc", source: "a.md" },
      { id: "b", description: "B doc", source: "b.md" },
    ]);
    expect(getRagFileCatalog()).toHaveLength(2);
    expect(getRagSourceById("a")?.source).toBe("a.md");
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      registerRagFileCatalog([
        { id: "x", description: "1", source: "1.md" },
        { id: "x", description: "2", source: "2.md" },
      ]),
    ).toThrow(/Duplicate RAG catalog id/);
  });

  it("list_rag_sources omits filesystem paths from the payload", async () => {
    registerRagFileCatalog([{ id: "handbook", description: "Policy", source: "secret/path.md" }]);
    const out = (await listRagSourcesTool.execute(
      {},
      {} as ToolContext,
    )) as { sources: Array<Record<string, unknown>> };
    expect(out.sources).toEqual([{ id: "handbook", description: "Policy" }]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("ingest_rag_source rejects unknown id", async () => {
    registerRagFileCatalog([]);
    const out = (await ingestRagSourceTool.execute(
      { id: "nope" },
      {} as ToolContext,
    )) as { success: boolean; error?: string };
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Unknown RAG catalog id/);
  });

  it("ToolContext.ragFileCatalog overrides the global register", async () => {
    registerRagFileCatalog([{ id: "global", description: "G", source: "g.md" }]);
    const ctx = {
      ragFileCatalog: [{ id: "rt", description: "R", source: "r.md" }],
    } as ToolContext;
    expect(resolveRagCatalog(ctx)).toEqual([
      { id: "rt", description: "R", source: "r.md" },
    ]);
    const out = (await listRagSourcesTool.execute({}, ctx)) as {
      sources: Array<{ id: string; description: string }>;
    };
    expect(out.sources).toEqual([{ id: "rt", description: "R" }]);
  });

  it("registerRagCatalog(runtime, projectId, sources) delegates to AgentRuntime", () => {
    const llm: LLMAdapter = {
      async generate(_req: LLMRequest): Promise<LLMResponse> {
        return { content: "{}" };
      },
    };
    const rt = new AgentRuntime({
      llmAdapter: llm,
      memoryAdapter: new InMemoryMemoryAdapter(),
    });
    registerRagCatalog(rt, "p1", [{ id: "x", description: "X", source: "x.md" }]);
    expect(rt.ragCatalogForProject("p1")).toEqual([
      { id: "x", description: "X", source: "x.md" },
    ]);
  });
});
