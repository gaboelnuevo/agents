import type {
  EmbeddingAdapter,
  LLMAdapter,
  LLMRequest,
  LLMResponse,
} from "@agent-runtime/core";
import { rethrowFetchFailure, throwForOpenAIHttpStatus } from "./errors.js";

function mapOpenAiFinishReason(raw: unknown): string {
  if (typeof raw === "string" && raw.length > 0) return raw;
  return "stop";
}

export type OpenAIEmbeddingAdapterOptions = {
  baseUrl?: string;
  /**
   * Exposed as {@link EmbeddingAdapter.dimensions}. If omitted, a model-name heuristic is used
   * until the first successful response, then updated from the embedding vector length.
   */
  dimensions?: number;
  /** Forwarded to `fetch`; aborting it aborts the embeddings request. */
  signal?: AbortSignal;
  /**
   * Aborts the embeddings `fetch` after this many milliseconds (internal `AbortController` + `setTimeout`,
   * merged with {@link signal}).
   */
  fetchTimeoutMs?: number;
};

export class OpenAILLMAdapter implements LLMAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = request.toolChoice ?? "auto";
    }
    if (request.responseFormat) {
      body.response_format = request.responseFormat;
    }
    if (request.maxOutputTokens != null) body.max_tokens = request.maxOutputTokens;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (e: unknown) {
      rethrowFetchFailure(e, "OpenAI chat/completions");
    }

    if (!res.ok) {
      const text = await res.text();
      throwForOpenAIHttpStatus(res.status, text);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const first = data.choices?.[0];
    const choice = first?.message;
    const content = choice?.content ?? "";
    const toolCalls = choice?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: typeof content === "string" ? content : "",
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      finishReason: mapOpenAiFinishReason(first?.finish_reason),
      raw: data,
    };
  }
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly embedOpts: OpenAIEmbeddingAdapterOptions;

  constructor(
    apiKey: string,
    model: string,
    baseUrlOrOptions: string | OpenAIEmbeddingAdapterOptions = {},
  ) {
    this.apiKey = apiKey;
    this.model = model;
    const opts: OpenAIEmbeddingAdapterOptions =
      typeof baseUrlOrOptions === "string" ? { baseUrl: baseUrlOrOptions } : baseUrlOrOptions;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.embedOpts = opts;
    this.dimensions = opts.dimensions ?? (model.includes("3-small") ? 1536 : 3072);
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { signal: outer, fetchTimeoutMs } = this.embedOpts;
    const ac = new AbortController();
    const stop = (): void => {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    };

    let onOuterAbort: (() => void) | undefined;
    if (outer) {
      if (outer.aborted) stop();
      else {
        onOuterAbort = stop;
        outer.addEventListener("abort", onOuterAbort, { once: true });
      }
    }

    let tid: ReturnType<typeof setTimeout> | undefined;
    if (fetchTimeoutMs != null && fetchTimeoutMs > 0) {
      tid = setTimeout(stop, fetchTimeoutMs);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: ac.signal,
      });
    } catch (e: unknown) {
      if (tid !== undefined) clearTimeout(tid);
      if (outer && onOuterAbort) outer.removeEventListener("abort", onOuterAbort);
      rethrowFetchFailure(e, "OpenAI embeddings");
    }
    if (tid !== undefined) clearTimeout(tid);
    if (outer && onOuterAbort) outer.removeEventListener("abort", onOuterAbort);
    if (!res.ok) {
      const text = await res.text();
      throwForOpenAIHttpStatus(res.status, text);
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const vectors = data.data.map((d) => d.embedding);
    const len = vectors[0]?.length;
    if (
      this.embedOpts.dimensions == null &&
      typeof len === "number" &&
      len > 0
    ) {
      this.dimensions = len;
    }
    return vectors;
  }
}
