import { describe, expect, it } from "vitest";
import { buildRuntimeRestOpenApiSpec } from "../src/openapi.js";

describe("buildRuntimeRestOpenApiSpec", () => {
  it("defines RuntimeRestJsonError under components.schemas", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: true,
      multiProject: false,
      hasApiKey: false,
    });
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    expect(schemas.RuntimeRestJsonError).toMatchObject({
      type: "object",
      required: ["error"],
    });
  });

  it("inline POST /agents/{agentId}/run documents engine-related HTTP statuses", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: false,
      multiProject: false,
      hasApiKey: false,
    });
    const run = (spec.paths as Record<string, unknown>)["/agents/{agentId}/run"] as {
      post: { responses: Record<string, unknown> };
    };
    expect(run.post.responses["409"]).toBeDefined();
    expect(run.post.responses["429"]).toBeDefined();
    expect(run.post.responses["500"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RuntimeRestJsonError" },
        },
      },
    });
  });

  it("dispatch POST run 202 schema requires projectId", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: true,
      hasRunStore: false,
      multiProject: false,
      hasApiKey: false,
    });
    const run = (spec.paths as Record<string, unknown>)["/agents/{agentId}/run"] as {
      post: { responses: Record<string, unknown> };
    };
    const content = (run.post.responses["202"] as { content: { "application/json": { schema: { required: string[] } } } })
      .content["application/json"].schema;
    expect(content.required).toContain("projectId");
  });

  it("merges securitySchemes with schemas when hasApiKey", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: false,
      multiProject: false,
      hasApiKey: true,
    });
    const components = spec.components as Record<string, unknown>;
    expect(components.securitySchemes).toBeDefined();
    expect((components.schemas as Record<string, unknown>).RuntimeRestJsonError).toBeDefined();
  });

  it("includes GET /agents/{agentId}/memory when hasMemoryRead", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasMemoryRead: true,
      hasRunStore: false,
      multiProject: false,
      hasApiKey: false,
    });
    expect((spec.paths as Record<string, unknown>)["/agents/{agentId}/memory"]).toBeDefined();
    const tags = spec.tags as Array<{ name: string }>;
    expect(tags.some((t) => t.name === "Memory")).toBe(true);
  });

  it("includes GET /agents/{agentId}/runs when hasRunStore", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: true,
      multiProject: false,
      hasApiKey: false,
    });
    expect((spec.paths as Record<string, unknown>)["/agents/{agentId}/runs"]).toBeDefined();
  });

  it("includes GET /runs/{runId}/history when hasRunStore", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: true,
      multiProject: false,
      hasApiKey: false,
    });
    expect((spec.paths as Record<string, unknown>)["/runs/{runId}/history"]).toBeDefined();
  });

  it("includes GET /sessions/{sessionId}/status and Sessions tag when hasRunStore", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasRunStore: true,
      multiProject: false,
      hasApiKey: false,
    });
    expect((spec.paths as Record<string, unknown>)["/sessions/{sessionId}/status"]).toBeDefined();
    const tags = spec.tags as Array<{ name: string }>;
    expect(tags.some((t) => t.name === "Sessions")).toBe(true);
  });

  it("includes POST /agents/{fromAgentId}/send when hasInterAgentSend", () => {
    const spec = buildRuntimeRestOpenApiSpec({
      hasDispatch: false,
      hasInterAgentSend: true,
      hasRunStore: false,
      multiProject: false,
      hasApiKey: false,
    });
    expect((spec.paths as Record<string, unknown>)["/agents/{fromAgentId}/send"]).toBeDefined();
  });
});
