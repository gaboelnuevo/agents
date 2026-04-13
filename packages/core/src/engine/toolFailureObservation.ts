import {
  EngineError,
  ToolExecutionError,
  ToolNotAllowedError,
  ToolTimeoutError,
  ToolValidationError,
} from "../errors/index.js";

/**
 * Shape appended to run history when `ToolRunner.execute` throws.
 * Does not forward arbitrary third-party error messages to the LLM (see `docs/planning/technical-debt-security-production.md` §1).
 */
export function observationForToolFailure(error: unknown): {
  success: false;
  error: string;
  code: string;
} {
  if (error instanceof ToolNotAllowedError || error instanceof ToolValidationError) {
    return { success: false, error: error.message, code: error.code };
  }
  if (error instanceof ToolTimeoutError) {
    return { success: false, error: "Tool timed out", code: error.code };
  }
  if (error instanceof ToolExecutionError) {
    return { success: false, error: "Tool execution failed", code: error.code };
  }
  if (error instanceof EngineError) {
    return { success: false, error: "Tool execution failed", code: error.code };
  }
  return {
    success: false,
    error: "Tool execution failed",
    code: "TOOL_EXECUTION_ERROR",
  };
}
