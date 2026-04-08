import type {
  EmbeddingAdapter,
  LLMAdapter,
  LLMRequest,
  LLMResponse,
} from "@agent-runtime/core";
import { rethrowFetchFailure, throwForOpenAIHttpStatus } from "./errors.js";

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

    const choice = data.choices?.[0]?.message;
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
      finishReason: "stop",
      raw: data,
    };
  }
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  dimensions: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {
    this.dimensions = model.includes("3-small") ? 1536 : 3072;
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (e: unknown) {
      rethrowFetchFailure(e, "OpenAI embeddings");
    }
    if (!res.ok) {
      const text = await res.text();
      throwForOpenAIHttpStatus(res.status, text);
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }
}
