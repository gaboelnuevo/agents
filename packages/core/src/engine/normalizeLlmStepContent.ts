import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";

/**
 * When an LLM adapter returns **native tool calls** with an empty (or whitespace-only) `content`
 * string, `parseStep` cannot read the protocol JSON. Maps the **first** `toolCalls` entry into a
 * synthetic `content` payload `{ type: "action", tool, input }` so the main loop runs tools the
 * same as for JSON `action` steps.
 *
 * If `content` is already non-empty, returns the response unchanged.
 */
export function normalizeLlmStepContent(response: LLMResponse): LLMResponse {
  const trimmed = response.content?.trim() ?? "";
  if (trimmed.length > 0) return response;

  const tc = response.toolCalls?.[0];
  if (!tc) return response;

  let input: unknown = {};
  try {
    input = tc.arguments ? (JSON.parse(tc.arguments) as unknown) : {};
  } catch {
    input = { _rawArguments: tc.arguments };
  }

  return {
    ...response,
    content: JSON.stringify({
      type: "action",
      tool: tc.name,
      input,
    }),
    toolCalls: undefined,
  };
}
