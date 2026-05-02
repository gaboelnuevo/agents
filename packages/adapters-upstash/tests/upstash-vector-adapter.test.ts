import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpstashVectorAdapter } from "../src/index.js";

describe("UpstashVectorAdapter filter normalization", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serializes object filter to Upstash string expression on delete", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: null }), { status: 200 }),
    );

    const adapter = new UpstashVectorAdapter("https://vector.example", "token");
    await adapter.delete("ns", {
      filter: { source: "common-gps-tracking-issues.md" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { filter?: string };
    expect(body.filter).toBe('source = "common-gps-tracking-issues.md"');
  });

  it("serializes object filter to Upstash string expression on query", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: [] }), { status: 200 }),
    );

    const adapter = new UpstashVectorAdapter("https://vector.example", "token");
    await adapter.query("ns", {
      vector: [0.1, 0.2],
      topK: 3,
      filter: { source: "common-gps-tracking-issues.md" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { filter?: string };
    expect(body.filter).toBe('source = "common-gps-tracking-issues.md"');
  });

  it("sends explicit data on upsert and keeps metadata filter fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: null }), { status: 200 }),
    );

    const adapter = new UpstashVectorAdapter("https://vector.example", "token");
    await adapter.upsert("ns", [
      {
        id: "doc-1",
        vector: [0.1, 0.2],
        data: "hello world",
        metadata: { source: "common-gps-tracking-issues.md" },
      },
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Array<{
      data?: string;
      metadata?: Record<string, unknown>;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.data).toBe("hello world");
    expect(body[0]?.metadata?.source).toBe("common-gps-tracking-issues.md");
  });

  it("maps query data from metadata fallback when provider omits top-level data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              id: "doc-1",
              score: 0.9,
              metadata: { data: "hello world", source: "common-gps-tracking-issues.md" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const adapter = new UpstashVectorAdapter("https://vector.example", "token");
    const results = await adapter.query("ns", {
      vector: [0.1, 0.2],
      topK: 3,
      includeData: true,
      includeMetadata: true,
    });

    expect(results[0]?.data).toBe("hello world");
    expect(results[0]?.metadata?.source).toBe("common-gps-tracking-issues.md");
  });
});
