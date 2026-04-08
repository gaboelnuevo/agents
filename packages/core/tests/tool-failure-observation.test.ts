import { describe, it, expect } from "vitest";
import { observationForToolFailure } from "../src/engine/toolFailureObservation.js";
import {
  ToolExecutionError,
  ToolNotAllowedError,
  ToolTimeoutError,
  ToolValidationError,
} from "../src/errors/index.js";

describe("observationForToolFailure", () => {
  it("hides ToolExecutionError message", () => {
    const o = observationForToolFailure(
      new ToolExecutionError("ENOENT: secret path /etc/foo"),
    );
    expect(o.code).toBe("TOOL_EXECUTION_ERROR");
    expect(o.error).toBe("Tool execution failed");
    expect(o.error).not.toContain("ENOENT");
  });

  it("keeps controlled ToolNotAllowed and ToolValidation messages", () => {
    const na = observationForToolFailure(new ToolNotAllowedError("Tool not allowed for agent: x"));
    expect(na.code).toBe("TOOL_NOT_ALLOWED");
    expect(na.error).toContain("not allowed");

    const tv = observationForToolFailure(new ToolValidationError("Validation failed for tool: t"));
    expect(tv.code).toBe("TOOL_VALIDATION_ERROR");
    expect(tv.error).toContain("Validation");
  });

  it("uses generic timeout text for ToolTimeoutError", () => {
    const o = observationForToolFailure(
      new ToolTimeoutError("Tool timed out after 40ms: slow_tool"),
    );
    expect(o.code).toBe("TOOL_TIMEOUT");
    expect(o.error).toBe("Tool timed out");
    expect(o.error).not.toContain("slow_tool");
  });
});
