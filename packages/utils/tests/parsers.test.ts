import { describe, it, expect } from "vitest";
import { parseFile, registerParser } from "../src/parsers/index.js";

describe("parseFile", () => {
  it("parses plain text", async () => {
    const buf = Buffer.from("Hello world");
    const res = await parseFile(buf, "text/plain");
    expect(res.text).toBe("Hello world");
    expect(res.metadata.mimeType).toBe("text/plain");
  });

  it("parses markdown as text/markdown", async () => {
    const buf = Buffer.from("# Title\n\nBody");
    const res = await parseFile(buf, "text/markdown");
    expect(res.text).toContain("# Title");
  });

  it("parses CSV", async () => {
    const buf = Buffer.from("a,b,c\n1,2,3");
    const res = await parseFile(buf, "text/csv");
    expect(res.text).toContain("a,b,c");
    expect(res.metadata.mimeType).toBe("text/csv");
  });

  it("parses HTML and strips tags", async () => {
    const buf = Buffer.from("<html><head><title>T</title></head><body><p>Hello</p></body></html>");
    const res = await parseFile(buf, "text/html");
    expect(res.text).toContain("Hello");
    expect(res.text).not.toContain("<p>");
    expect(res.metadata.title).toBe("T");
  });

  it("parses JSON with pretty-print", async () => {
    const buf = Buffer.from('{"a":1}');
    const res = await parseFile(buf, "application/json");
    expect(res.text).toContain('"a": 1');
  });

  it("throws on unsupported mime", async () => {
    const buf = Buffer.from("binary");
    await expect(parseFile(buf, "video/mp4")).rejects.toThrow("unsupported mimeType");
  });

  it("supports custom parsers via registerParser", async () => {
    registerParser("application/x-custom", async (b) => ({
      text: `custom:${b.toString()}`,
      metadata: { mimeType: "application/x-custom" },
    }));
    const buf = Buffer.from("data");
    const res = await parseFile(buf, "application/x-custom");
    expect(res.text).toBe("custom:data");
  });
});
