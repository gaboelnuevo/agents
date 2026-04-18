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
});
