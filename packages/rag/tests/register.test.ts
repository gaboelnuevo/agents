import { describe, it, beforeEach, expect } from "vitest";
import { registerRagToolsAndSkills } from "../src/register.js";
import { __resetRagFileCatalogForTests } from "../src/catalog.js";
import { clearAllRegistriesForTests } from "@agent-runtime/core";

describe("registerRagToolsAndSkills", () => {
  beforeEach(() => {
    clearAllRegistriesForTests();
    __resetRagFileCatalogForTests();
  });

  it("registers without error", async () => {
    await expect(registerRagToolsAndSkills()).resolves.toBeUndefined();
  });

  it("is idempotent for same process", async () => {
    await registerRagToolsAndSkills();
    await expect(registerRagToolsAndSkills()).resolves.toBeUndefined();
  });
});
