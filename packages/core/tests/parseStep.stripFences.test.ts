import { describe, expect, it } from "vitest";
import { extractFirstBalancedJsonObject, parseStep, stripFences } from "../src/engine/parseStep.js";

describe("stripFences", () => {
  it("returns inner JSON when the whole message is one fence", () => {
    const inner = '{"type":"thought","content":"x"}';
    const wrapped = "```json\n" + inner + "\n```";
    expect(stripFences(wrapped)).toBe(inner);
  });

  it("extracts fenced JSON after leading prose", () => {
    const inner = '{"type":"thought","content":"ok"}';
    const raw = `Here is the step:\n\`\`\`json\n${inner}\n\`\`\`\n`;
    expect(stripFences(raw)).toBe(inner);
  });
});

describe("extractFirstBalancedJsonObject", () => {
  it("ignores braces inside JSON strings", () => {
    const inner = '{"type":"thought","content":"brace } mid { end"}';
    const s = "prefix " + inner + " suffix";
    expect(extractFirstBalancedJsonObject(s)).toBe(inner);
  });
});

describe("parseStep with chatty wrappers", () => {
  it("parses thought when model wraps JSON in a fence after text", () => {
    const inner = JSON.stringify({ type: "thought", content: "plan" });
    const raw = `Sure.\n\`\`\`json\n${inner}\n\`\`\``;
    expect(parseStep(raw)).toEqual({ type: "thought", content: "plan" });
  });

  it("parses raw JSON object embedded in prose without fences", () => {
    const raw = 'Here you go: {"type":"thought","content":"x"} — end.';
    expect(parseStep(raw)).toEqual({ type: "thought", content: "x" });
  });

  it("parses fence without newline after json tag", () => {
    const inner = '{"type":"result","content":"ok"}';
    const raw = "```json" + inner + "```";
    expect(parseStep(raw)).toEqual({ type: "result", content: "ok" });
  });

  it("unwraps a single-element JSON array", () => {
    const raw = '[{"type":"thought","content":"from array"}]';
    expect(parseStep(raw)).toEqual({ type: "thought", content: "from array" });
  });

  it("normalizes nested action { name, params } (common LLM shape)", () => {
    const raw = JSON.stringify({
      type: "action",
      action: { name: "invoke_planner", params: { goal: "research Honduras" } },
    });
    expect(parseStep(raw)).toEqual({
      type: "action",
      tool: "invoke_planner",
      input: { goal: "research Honduras" },
    });
  });

  it("normalizes top-level name + params", () => {
    const raw = JSON.stringify({
      type: "action",
      name: "runtime_fetch_run",
      params: { runId: "run-1" },
    });
    expect(parseStep(raw)).toEqual({
      type: "action",
      tool: "runtime_fetch_run",
      input: { runId: "run-1" },
    });
  });

  it("normalizes function_call with JSON string arguments", () => {
    const raw = JSON.stringify({
      type: "action",
      function_call: { name: "invoke_planner", arguments: '{"goal":"x"}' },
    });
    expect(parseStep(raw)).toEqual({
      type: "action",
      tool: "invoke_planner",
      input: { goal: "x" },
    });
  });

  it("coerces result.content object to string (common LLM mistake)", () => {
    const raw = JSON.stringify({
      type: "result",
      content: { message: "hello", n: 1 },
    });
    expect(parseStep(raw)).toEqual({
      type: "result",
      content: '{"message":"hello","n":1}',
    });
  });

  it("coerces thought.content array to string", () => {
    const raw = JSON.stringify({ type: "thought", content: ["a", "b"] });
    expect(parseStep(raw)).toEqual({ type: "thought", content: '["a","b"]' });
  });

  it("maps result.message to content (chat-style JSON)", () => {
    const raw = JSON.stringify({
      type: "result",
      message: "¡Hola! ¿En qué puedo ayudarte?",
    });
    expect(parseStep(raw)).toEqual({
      type: "result",
      content: "¡Hola! ¿En qué puedo ayudarte?",
    });
  });

  it("maps thought.text to content when content is absent", () => {
    const raw = JSON.stringify({ type: "thought", text: "planning…" });
    expect(parseStep(raw)).toEqual({ type: "thought", content: "planning…" });
  });
});
