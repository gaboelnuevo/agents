import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryMemoryAdapter, type ToolContext, type VectorDeleteParams } from "@opencoreagents/core";
import { runFileIngestPipeline } from "../src/tools/fileIngestCore.js";

describe("runFileIngestPipeline hash skip", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("skips embedding/upsert when source content hash is unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-ingest-test-"));
    tempDirs.push(dir);
    const source = "kb.md";
    await writeFile(join(dir, source), "# Doc\n\nHello world from RAG.\n", "utf8");

    const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
    const upsert = vi.fn(async () => {});
    const del = vi.fn(async (_namespace: string, _params: VectorDeleteParams) => {});

    const ctx = {
      projectId: "p1",
      agentId: "a1",
      runId: "r1",
      sessionId: "s1",
      memoryAdapter: new InMemoryMemoryAdapter(),
      securityContext: {},
      fileReadRoot: dir,
      embeddingAdapter: {
        dimensions: 3,
        embed: async () => [0.1, 0.2, 0.3],
        embedBatch,
      },
      vectorAdapter: {
        upsert,
        delete: del,
        query: async () => [],
      },
    } as unknown as ToolContext;

    const first = await runFileIngestPipeline(ctx, source);
    const second = await runFileIngestPipeline(ctx, source);

    expect(first.status).toBe("completed");
    expect(first.chunksCreated).toBeGreaterThan(0);
    expect(second.status).toBe("skipped_unchanged");
    expect(second.chunksCreated).toBe(0);
    expect(embedBatch).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(second.documentId).toBe(first.documentId);
    expect(second.sourceHash).toBe(first.sourceHash);
  });
});
