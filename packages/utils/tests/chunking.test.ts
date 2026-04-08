import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunking/index.js";

describe("chunkText", () => {
  const longText = Array.from({ length: 100 }, (_, i) => `Sentence ${i}.`).join(" ");

  it("fixed_size produces chunks within maxTokens", () => {
    const chunks = chunkText(longText, { method: "fixed_size", maxTokens: 50, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(55);
    }
  });

  it("sentence preserves sentence boundaries", () => {
    const chunks = chunkText(longText, { method: "sentence", maxTokens: 100, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.endsWith(".") || chunks.indexOf(c) === chunks.length - 1).toBe(true);
    }
  });

  it("paragraph splits on double newlines", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = chunkText(text, { method: "paragraph", maxTokens: 100, overlap: 0 });
    expect(chunks.length).toBe(1); // all fit in one chunk
    expect(chunks[0]!.content).toContain("Paragraph one.");
  });

  it("paragraph splits large content", () => {
    const paras = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some longer text to fill space.`);
    const text = paras.join("\n\n");
    const chunks = chunkText(text, { method: "paragraph", maxTokens: 30, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("recursive falls back gracefully", () => {
    const chunks = chunkText(longText, { method: "recursive", maxTokens: 50, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunks have correct index and offsets", () => {
    const chunks = chunkText("Hello. World.", { method: "sentence", maxTokens: 100, overlap: 0 });
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.startOffset).toBe(0);
  });
});
