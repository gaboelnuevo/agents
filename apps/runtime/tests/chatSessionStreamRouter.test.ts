import { describe, expect, it } from "vitest";
import { chatBindingRedisKey } from "../src/http/chatSessionStreamRouter.js";

describe("chatBindingRedisKey", () => {
  it("builds key with trimmed prefix and project/session", () => {
    expect(chatBindingRedisKey("def", "p1", "sess-a")).toBe("def:chatBinding:p1:sess-a");
  });

  it("drops trailing colons on definitions prefix", () => {
    expect(chatBindingRedisKey("mydef::", "p", "s")).toBe("mydef:chatBinding:p:s");
  });

  it("uses def when prefix is empty after trim", () => {
    expect(chatBindingRedisKey("   ", "p", "s")).toBe("def:chatBinding:p:s");
  });

  it("adds tenant segment when tenantId is provided", () => {
    expect(chatBindingRedisKey("def", "p1", "sess-a", "tenant-x")).toBe(
      "def:chatBinding:p1:tenant-x:sess-a",
    );
  });
});
