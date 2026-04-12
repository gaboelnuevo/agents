import { describe, expect, it } from "vitest";
import { isBullmqJobWaitTimeoutError } from "../src/bullmqJobWaitTimeout.js";

describe("isBullmqJobWaitTimeoutError", () => {
  it("returns true for BullMQ waitUntilFinished TTL message shape", () => {
    expect(
      isBullmqJobWaitTimeoutError(
        new Error(
          "Job wait my-queue timed out before finishing, no finish notification arrived after 5000ms (id=7)",
        ),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isBullmqJobWaitTimeoutError(new Error("Job failed: boom"))).toBe(false);
    expect(
      isBullmqJobWaitTimeoutError(
        new Error("Something timed out before finishing without Job wait prefix"),
      ),
    ).toBe(false);
  });
});
