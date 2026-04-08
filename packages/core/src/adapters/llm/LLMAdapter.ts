export interface LLMRequest {
  provider: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tools?: Array<{ name: string; description?: string; parameters: object }>;
  toolChoice?: "auto" | "none" | { type: "tool"; name: string };
  responseFormat?: { type: "json_object" } | { type: "json_schema"; schema: object };
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onStreamChunk?: (text: string) => void;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | string;
  raw?: unknown;
}

export interface LLMAdapter {
  generate(request: LLMRequest): Promise<LLMResponse>;
}
