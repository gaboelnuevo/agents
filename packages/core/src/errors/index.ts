export abstract class EngineError extends Error {
  abstract readonly code: string;
  constructor(message?: string) {
    super(message ?? "EngineError");
    this.name = new.target.name;
  }
}

export class RunInvalidStateError extends EngineError {
  readonly code = "RUN_INVALID_STATE";
}
export class StepSchemaError extends EngineError {
  readonly code = "STEP_SCHEMA_ERROR";
}
export class ToolNotAllowedError extends EngineError {
  readonly code = "TOOL_NOT_ALLOWED";
}
export class ToolExecutionError extends EngineError {
  readonly code = "TOOL_EXECUTION_ERROR";
}
export class ToolValidationError extends EngineError {
  readonly code = "TOOL_VALIDATION_ERROR";
}
export class ToolTimeoutError extends EngineError {
  readonly code = "TOOL_TIMEOUT";
}
export class MaxIterationsError extends EngineError {
  readonly code = "MAX_ITERATIONS_EXCEEDED";
}
export class RunTimeoutError extends EngineError {
  readonly code = "RUN_TIMEOUT";
}
export class LLMTransportError extends EngineError {
  readonly code = "LLM_TRANSPORT_ERROR";
}
export class LLMRateLimitError extends EngineError {
  readonly code = "LLM_RATE_LIMIT";
}
export class LLMClientError extends EngineError {
  readonly code = "LLM_CLIENT_ERROR";
}
export class RunCancelledError extends EngineError {
  readonly code = "RUN_CANCELLED";
}
export class SecurityError extends EngineError {
  readonly code = "SECURITY_DENIED";
}
export class SessionExpiredError extends EngineError {
  readonly code = "SESSION_EXPIRED";
}

/** Queued job included **`expiresAtMs`** and the worker ran after that deadline (see `adapters-bullmq` payload). */
export class EngineJobExpiredError extends EngineError {
  readonly code = "ENGINE_JOB_EXPIRED";
}
