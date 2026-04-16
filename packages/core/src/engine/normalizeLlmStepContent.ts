import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";
import { parseStep } from "./parseStep.js";

function syntheticActionFromToolCall(tc: NonNullable<LLMResponse["toolCalls"]>[0]): LLMResponse {
  let input: unknown = {};
  try {
    input = tc.arguments ? (JSON.parse(tc.arguments) as unknown) : {};
  } catch {
    input = { _rawArguments: tc.arguments };
  }
  return {
    content: JSON.stringify({
      type: "action",
      tool: tc.name,
      input,
    }),
    toolCalls: undefined,
  };
}

/**
 * When an LLM adapter returns **native tool calls**, `parseStep` needs a single protocol JSON in
 * **`content`**. If **`content`** is empty, or non-empty but **not** a valid Step (common when
 * Anthropic emits prose before **`tool_use`** blocks), maps the **first** `toolCalls` entry into
 * **`{ type: "action", tool, input }`** and clears **`toolCalls`** so the engine loop matches the
 * OpenAI-style path.
 */
export function normalizeLlmStepContent(response: LLMResponse): LLMResponse {
  const trimmed = response.content?.trim() ?? "";
  const tc = response.toolCalls?.[0];
  if (!tc) return response;

  if (trimmed.length === 0) {
    return { ...response, ...syntheticActionFromToolCall(tc) };
  }

  try {
    parseStep(trimmed);
    return response;
  } catch {
    return { ...response, ...syntheticActionFromToolCall(tc) };
  }
}
