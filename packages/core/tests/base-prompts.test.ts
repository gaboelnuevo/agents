import { describe, expect, it } from "vitest";
import {
  BASE_PROMPT,
  BASE_PROMPT_WITH_SHORT_ANSWERS,
} from "../src/prompts/basePrompts.js";
import { parseStep } from "../src/engine/parseStep.js";

describe("base prompts (protocol-safe)", () => {
  it("exports BASE_PROMPT with explicit result.content contract", () => {
    expect(BASE_PROMPT).toContain('"type":"result"');
    expect(BASE_PROMPT).toContain('"content"');
  });

  it("parses standard result step shape expected by BASE_PROMPT", () => {
    const raw = JSON.stringify({ type: "result", content: "Hello there." });
    const step = parseStep(raw);
    expect(step).toEqual({ type: "result", content: "Hello there." });
  });

  it("parses short-answers result as protocol-safe content string", () => {
    const envelope = {
      reply: "Hello! How can I help?",
      short_answers: [],
    };
    const raw = JSON.stringify({
      type: "result",
      content: JSON.stringify(envelope),
    });
    const step = parseStep(raw);
    expect(step.type).toBe("result");
    expect(typeof (step as { content: unknown }).content).toBe("string");
    const parsed = JSON.parse((step as { content: string }).content) as {
      reply: string;
      short_answers: unknown[];
    };
    expect(parsed.reply).toBe("Hello! How can I help?");
    expect(Array.isArray(parsed.short_answers)).toBe(true);
    expect(parsed.short_answers).toEqual([]);
  });

  it("includes short_answers array rule in BASE_PROMPT_WITH_SHORT_ANSWERS", () => {
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain("short_answers");
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain("use [] when not applicable");
  });

  it("includes wait.details.short_answers contract in BASE_PROMPT_WITH_SHORT_ANSWERS", () => {
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain('"type":"wait"');
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain('"details":{"short_answers"');
  });

  it("includes protocol examples in both base prompts", () => {
    expect(BASE_PROMPT).toContain("Examples:");
    expect(BASE_PROMPT).toContain('"type":"action"');
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain('\\"reply\\"');
    expect(BASE_PROMPT_WITH_SHORT_ANSWERS).toContain('"details":{"short_answers"');
  });
});
