import { EngineError } from "@opencoreagents/core";

/** JSON body for mapped engine failures (`error` + stable **`code`**). */
export interface RuntimeRestEngineErrorBody {
  error: string;
  code: string;
}

/**
 * `EngineError.code` values with explicit HTTP mapping in {@link mapEngineErrorToHttp}.
 * Other codes may still appear with status **500** from the `default` branch.
 */
export const RUNTIME_REST_ENGINE_ERROR_CODES = [
  "SESSION_EXPIRED",
  "SECURITY_DENIED",
  "TOOL_NOT_ALLOWED",
  "STEP_SCHEMA_ERROR",
  "TOOL_VALIDATION_ERROR",
  "RUN_INVALID_STATE",
  "RUN_CANCELLED",
  "ENGINE_JOB_EXPIRED",
  "TOOL_TIMEOUT",
  "RUN_TIMEOUT",
  "MAX_ITERATIONS_EXCEEDED",
  "LLM_RATE_LIMIT",
  "LLM_TRANSPORT_ERROR",
  "LLM_CLIENT_ERROR",
  "TOOL_EXECUTION_ERROR",
] as const;

/**
 * Map **`EngineError`** from **`@opencoreagents/core`** to HTTP status + body for inline routes.
 * Covers phased plan **R0** (contract) in **`docs/plan-rest.md`**; unknown errors stay **`null`** (caller uses generic **500** / **400**).
 */
export function mapEngineErrorToHttp(e: unknown): {
  status: number;
  body: RuntimeRestEngineErrorBody;
} | null {
  if (!(e instanceof EngineError)) return null;
  const code = e.code;
  const error = e.message?.trim() ? e.message : code;
  const body: RuntimeRestEngineErrorBody = { error, code };

  switch (code) {
    case "SESSION_EXPIRED":
      return { status: 401, body };
    case "SECURITY_DENIED":
    case "TOOL_NOT_ALLOWED":
      return { status: 403, body };
    case "STEP_SCHEMA_ERROR":
    case "TOOL_VALIDATION_ERROR":
      return { status: 400, body };
    case "RUN_INVALID_STATE":
    case "RUN_CANCELLED":
      return { status: 409, body };
    case "ENGINE_JOB_EXPIRED":
      return { status: 410, body };
    case "TOOL_TIMEOUT":
    case "RUN_TIMEOUT":
      return { status: 504, body };
    case "MAX_ITERATIONS_EXCEEDED":
      return { status: 500, body };
    case "LLM_RATE_LIMIT":
      return { status: 429, body };
    case "LLM_TRANSPORT_ERROR":
    case "LLM_CLIENT_ERROR":
    case "TOOL_EXECUTION_ERROR":
      return { status: 502, body };
    default:
      return { status: 500, body };
  }
}
