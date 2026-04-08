import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LLMClientError,
  LLMRateLimitError,
  LLMTransportError,
  RunCancelledError,
} from "@agent-runtime/core";
import { OpenAILLMAdapter, OpenAIEmbeddingAdapter } from "../src/index.js";

describe("OpenAILLMAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: '{"type":"result","content":"done"}',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs chat/completions and maps response to LLMResponse", async () => {
    const adapter = new OpenAILLMAdapter("sk-test", "https://api.openai.com/v1");
    const out = await adapter.generate({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.3,
    });

    expect(out.content).toBe('{"type":"result","content":"done"}');
    expect(out.finishReason).toBe("stop");
    expect(out.usage?.totalTokens).toBe(30);
    expect(out.usage?.promptTokens).toBe(10);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.temperature).toBe(0.3);
  });

  it("maps 429 to LLMRateLimitError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
    );
    const adapter = new OpenAILLMAdapter("sk-test");
    await expect(
      adapter.generate({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(LLMRateLimitError);
  });

  it("maps 5xx to LLMTransportError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const adapter = new OpenAILLMAdapter("sk-test");
    await expect(
      adapter.generate({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(LLMTransportError);
  });

  it("maps other 4xx to LLMClientError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const adapter = new OpenAILLMAdapter("sk-test");
    await expect(
      adapter.generate({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(LLMClientError);
  });

  it("wraps fetch network errors in LLMTransportError", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const adapter = new OpenAILLMAdapter("sk-test");
    await expect(
      adapter.generate({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(LLMTransportError);
  });

  it("maps API finish_reason to LLMResponse.finishReason", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"type":"thought","content":"…"}' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const adapter = new OpenAILLMAdapter("sk-test");
    const out = await adapter.generate({
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.finishReason).toBe("length");
  });

  it("defaults finishReason to stop when API omits it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new OpenAILLMAdapter("sk-test");
    const out = await adapter.generate({
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.finishReason).toBe("stop");
  });

  it("maps fetch AbortError to RunCancelledError", async () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    vi.mocked(fetch).mockRejectedValueOnce(aborted);
    const adapter = new OpenAILLMAdapter("sk-test");
    await expect(
      adapter.generate({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(RunCancelledError);
  });
});

describe("OpenAIEmbeddingAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates dimensions from embedding vector length after success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
          }),
          { status: 200 },
        ),
      ),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-ada-002");
    expect(adapter.dimensions).toBe(3072);
    await adapter.embedBatch(["a"]);
    expect(adapter.dimensions).toBe(4);
  });

  it("respects explicit dimensions option over heuristic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
          { status: 200 },
        ),
      ),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small", {
      dimensions: 99,
    });
    await adapter.embedBatch(["a"]);
    expect(adapter.dimensions).toBe(99);
  });

  it("embedBatch POSTs embeddings and returns vectors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
          }),
          { status: 200 },
        ),
      ),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small");
    const vectors = await adapter.embedBatch(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([0.1, 0.2, 0.3]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("embed delegates to embedBatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
        }),
      ),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small");
    const v = await adapter.embed("only");
    expect(v).toEqual([0.1, 0.2, 0.3]);
  });

  it("maps embeddings HTTP errors to typed LLM errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("limit", { status: 429 })),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small");
    await expect(adapter.embedBatch(["x"])).rejects.toThrow(LLMRateLimitError);
  });

  it("wraps embeddings fetch network errors in LLMTransportError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small");
    await expect(adapter.embedBatch(["x"])).rejects.toThrow(LLMTransportError);
  });

  it("maps AbortError from fetchTimeoutMs to RunCancelledError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          const sig = init?.signal;
          if (sig?.aborted) {
            const e = new Error("The operation was aborted");
            e.name = "AbortError";
            reject(e);
            return;
          }
          const late = setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
            );
          }, 500);
          sig?.addEventListener(
            "abort",
            () => {
              clearTimeout(late);
              const e = new Error("The operation was aborted");
              e.name = "AbortError";
              reject(e);
            },
            { once: true },
          );
        });
      }),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small", {
      fetchTimeoutMs: 25,
    });
    await expect(adapter.embedBatch(["x"])).rejects.toThrow(RunCancelledError);
  });

  it("maps aborted signal on embeddings to RunCancelledError", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          return Promise.reject(e);
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
        );
      }),
    );
    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small", {
      signal: ac.signal,
    });
    await expect(adapter.embedBatch(["x"])).rejects.toThrow(RunCancelledError);
  });
});
