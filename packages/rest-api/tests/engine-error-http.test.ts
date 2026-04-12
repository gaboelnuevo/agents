import { describe, expect, it } from "vitest";
import {
  EngineJobExpiredError,
  LLMClientError,
  LLMRateLimitError,
  LLMTransportError,
  MaxIterationsError,
  RunCancelledError,
  RunInvalidStateError,
  RunTimeoutError,
  SecurityError,
  SessionExpiredError,
  StepSchemaError,
  ToolExecutionError,
  ToolNotAllowedError,
  ToolTimeoutError,
  ToolValidationError,
} from "@opencoreagents/core";
import { mapEngineErrorToHttp } from "../src/engineErrorHttp.js";

describe("mapEngineErrorToHttp", () => {
  it("returns null for non-EngineError", () => {
    expect(mapEngineErrorToHttp(new Error("x"))).toBeNull();
    expect(mapEngineErrorToHttp("x")).toBeNull();
  });

  it("maps SESSION_EXPIRED to 401", () => {
    const m = mapEngineErrorToHttp(new SessionExpiredError("expired"));
    expect(m).toEqual({
      status: 401,
      body: { error: "expired", code: "SESSION_EXPIRED" },
    });
  });

  it("maps TOOL_NOT_ALLOWED and SECURITY_DENIED to 403", () => {
    expect(mapEngineErrorToHttp(new ToolNotAllowedError("nope"))!.status).toBe(403);
    expect(mapEngineErrorToHttp(new SecurityError("denied"))!.status).toBe(403);
  });

  it("maps validation / step schema to 400", () => {
    expect(mapEngineErrorToHttp(new ToolValidationError("bad"))!.status).toBe(400);
    expect(mapEngineErrorToHttp(new StepSchemaError("bad"))!.status).toBe(400);
  });

  it("maps RUN_INVALID_STATE and RUN_CANCELLED to 409", () => {
    expect(mapEngineErrorToHttp(new RunInvalidStateError("state"))!.status).toBe(409);
    expect(mapEngineErrorToHttp(new RunCancelledError("cancel"))!.status).toBe(409);
  });

  it("maps ENGINE_JOB_EXPIRED to 410", () => {
    expect(mapEngineErrorToHttp(new EngineJobExpiredError("late"))!.status).toBe(410);
  });

  it("maps timeouts to 504", () => {
    expect(mapEngineErrorToHttp(new ToolTimeoutError("t"))!.status).toBe(504);
    expect(mapEngineErrorToHttp(new RunTimeoutError("r"))!.status).toBe(504);
  });

  it("maps LLM_RATE_LIMIT to 429", () => {
    expect(mapEngineErrorToHttp(new LLMRateLimitError("slow"))!.status).toBe(429);
  });

  it("maps LLM and tool execution failures to 502", () => {
    expect(mapEngineErrorToHttp(new LLMTransportError("net"))!.status).toBe(502);
    expect(mapEngineErrorToHttp(new LLMClientError("4xx"))!.status).toBe(502);
    expect(mapEngineErrorToHttp(new ToolExecutionError("tool"))!.status).toBe(502);
  });

  it("maps MAX_ITERATIONS_EXCEEDED to 500", () => {
    expect(mapEngineErrorToHttp(new MaxIterationsError("max"))!.status).toBe(500);
  });
});
