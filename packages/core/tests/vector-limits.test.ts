import { describe, it, expect } from "vitest";
import {
  MAX_VECTOR_DELETE_IDS,
  MAX_VECTOR_TOPK,
  clampVectorTopK,
  isValidVectorDeleteInput,
} from "../src/tools/vectorLimits.js";

describe("vectorLimits", () => {
  it("clampVectorTopK defaults and caps", () => {
    expect(clampVectorTopK(undefined)).toBe(5);
    expect(clampVectorTopK(1)).toBe(1);
    expect(clampVectorTopK(9999)).toBe(MAX_VECTOR_TOPK);
    expect(clampVectorTopK(0)).toBe(1);
    expect(clampVectorTopK(NaN)).toBe(5);
  });

  it("isValidVectorDeleteInput requires ids and/or non-empty filter", () => {
    expect(isValidVectorDeleteInput({})).toBe(false);
    expect(isValidVectorDeleteInput({ ids: [] })).toBe(false);
    expect(isValidVectorDeleteInput({ filter: {} })).toBe(false);
    expect(isValidVectorDeleteInput({ ids: ["a"] })).toBe(true);
    expect(isValidVectorDeleteInput({ filter: { k: 1 } })).toBe(true);
    expect(isValidVectorDeleteInput({ ids: [], filter: { k: 1 } })).toBe(true);
    expect(isValidVectorDeleteInput({ ids: ["a"], filter: { k: 1 } })).toBe(true);
    expect(isValidVectorDeleteInput({ ids: "x" })).toBe(false);
    expect(isValidVectorDeleteInput({ ids: ["", "b"] })).toBe(false);
    expect(
      isValidVectorDeleteInput({
        ids: Array.from({ length: MAX_VECTOR_DELETE_IDS + 1 }, (_, i) => `id-${i}`),
      }),
    ).toBe(false);
  });
});
