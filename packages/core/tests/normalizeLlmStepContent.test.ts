import { describe, expect, it } from "vitest";
import { normalizeLlmStepContent } from "../src/engine/normalizeLlmStepContent.js";
import type { LLMResponse } from "../src/adapters/llm/LLMAdapter.js";

describe("normalizeLlmStepContent", () => {
  it("maps first tool call when content is empty", () => {
    const raw: LLMResponse = {
      content: "",
      toolCalls: [{ name: "spawn_agent", arguments: '{"goal":"x"}' }],
      finishReason: "tool_calls",
    };
    const out = normalizeLlmStepContent(raw);
    expect(out.toolCalls).toBeUndefined();
    expect(JSON.parse(out.content)).toEqual({
      type: "action",
      tool: "spawn_agent",
      input: { goal: "x" },
    });
  });

  it("prefers native tool call when content is prose (Anthropic-style)", () => {
    const raw: LLMResponse = {
      content: "I'll spawn a sub-agent now.\n",
      toolCalls: [{ name: "list_available_tools", arguments: "{}" }],
      finishReason: "tool_calls",
    };
    const out = normalizeLlmStepContent(raw);
    expect(out.toolCalls).toBeUndefined();
    expect(JSON.parse(out.content)).toEqual({
      type: "action",
      tool: "list_available_tools",
      input: {},
    });
  });

  it("leaves valid protocol JSON in content when tool calls are also present", () => {
    const step = JSON.stringify({ type: "thought", content: "planning" });
    const raw: LLMResponse = {
      content: step,
      toolCalls: [{ name: "spawn_agent", arguments: "{}" }],
    };
    const out = normalizeLlmStepContent(raw);
    expect(out.content).toBe(step);
    expect(out.toolCalls).toEqual(raw.toolCalls);
  });
});
