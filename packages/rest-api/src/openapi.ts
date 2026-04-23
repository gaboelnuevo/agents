/**
 * OpenAPI 3.0 document for **`createRuntimeRestRouter`** routes (Swagger UI / codegen).
 */
import { RUNTIME_REST_ENGINE_ERROR_CODES } from "./engineErrorHttp.js";

export interface RuntimeRestOpenApiInput {
  /** **`POST` run / resume / continue** enqueue to BullMQ when true. */
  hasDispatch: boolean;
  /** **`GET /agents/{agentId}/memory`** when **`runtime`** is set on the router (default **false**). */
  hasMemoryRead?: boolean;
  /** **`POST /agents/{fromAgentId}/send`** when **`runtime`** is set (**501** if **`AgentRuntime`** has no **`messageBus`**). */
  hasInterAgentSend?: boolean;
  /** **`GET /runs`** and inline **`resume`** available. */
  hasRunStore: boolean;
  /** Clients must send tenant via header/query/body (no fixed **`projectId`** in router options). */
  multiProject: boolean;
  /** **`apiKey`** option is set on the router. */
  hasApiKey: boolean;
  /** `info.title` (default **Runtime REST API**). */
  title?: string;
  /** `info.version` (default **0.0.0**). */
  version?: string;
  /** Extra `info.description` paragraph. */
  description?: string;
}

function securitySchemes(
  hasApiKey: boolean,
): Record<string, Record<string, unknown>> | undefined {
  if (!hasApiKey) return undefined;
  return {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      description:
        "Same secret the router expects (`apiKey` or `resolveApiKey`) — `Authorization: Bearer <key>`",
    },
    ApiKeyAuth: {
      type: "apiKey",
      in: "header",
      name: "X-Api-Key",
      description: "Alternative to Bearer — same secret as `apiKey` / `resolveApiKey`",
    },
  };
}

function globalSecurity(
  hasApiKey: boolean,
): Array<Record<string, string[]>> | undefined {
  if (!hasApiKey) return undefined;
  return [{ bearerAuth: [] }, { ApiKeyAuth: [] }];
}

function compactResponses(responses: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(responses)) {
    if (responses[k] === undefined) delete responses[k];
  }
  return responses;
}

function runtimeRestJsonErrorSchema(): Record<string, unknown> {
  const known = [...RUNTIME_REST_ENGINE_ERROR_CODES].join(", ");
  return {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
      code: {
        type: "string",
        description: `When present, failure came from an EngineError via mapEngineErrorToHttp. Known mapped codes: ${known}. Other values may appear (e.g. new engine types default to HTTP 500).`,
      },
    },
  };
}

/** Standard JSON error body: \`{ error }\` from the router; optional \`code\` for mapped engine failures. */
function jsonErr(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/RuntimeRestJsonError" },
      },
    },
  };
}

/** Build a plain JSON-serializable OpenAPI 3.0 object. */
export function buildRuntimeRestOpenApiSpec(input: RuntimeRestOpenApiInput): Record<string, unknown> {
  const {
    hasDispatch,
    hasMemoryRead = false,
    hasInterAgentSend = false,
    hasRunStore,
    multiProject,
    hasApiKey,
    title = "Runtime REST API",
    version = "0.0.0",
    description = "",
  } = input;

  const schemes = securitySchemes(hasApiKey);
  const security = globalSecurity(hasApiKey);

  const tenantParams: unknown[] = [];
  if (multiProject) {
    tenantParams.push({
      name: "X-Project-Id",
      in: "header",
      required: false,
      schema: { type: "string" },
      description:
        "Tenant when router has no fixed `projectId`. Also `?projectId=` (GET) or `body.projectId` (POST).",
    });
  }

  const runPostResponses: Record<string, unknown> = {
    "400": jsonErr(
      hasDispatch
        ? "Bad request (e.g. missing message)"
        : "Bad request (e.g. missing message) or engine STEP_SCHEMA_ERROR / TOOL_VALIDATION_ERROR",
    ),
    "401": hasApiKey
      ? jsonErr(
          hasDispatch
            ? "Missing or invalid API key"
            : "Missing or invalid API key or engine SESSION_EXPIRED",
        )
      : hasDispatch
        ? undefined
        : jsonErr("Engine SESSION_EXPIRED"),
    "403": jsonErr(
      hasDispatch
        ? "Unknown project (allowlist)"
        : "Unknown project (allowlist) or engine SECURITY_DENIED / TOOL_NOT_ALLOWED",
    ),
    "404": jsonErr("Unknown agent"),
    "501": hasDispatch
      ? { description: "wait=1 without queueEvents on router" }
      : undefined,
    "502": hasDispatch ? { description: "Job failed in queue" } : undefined,
    "503": hasDispatch ? { description: "Enqueue / queue error" } : undefined,
    "504": hasDispatch ? { description: "waitUntilFinished timeout" } : undefined,
  };
  compactResponses(runPostResponses);

  if (hasDispatch) {
    Object.assign(runPostResponses, {
      "200": {
        description: "Inline-style body when `wait=1` and job completed",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                jobId: { type: "string" },
                sessionId: { type: "string" },
                projectId: { type: "string" },
                runId: { type: "string" },
                status: { type: "string" },
                reply: { type: "string" },
              },
            },
          },
        },
      },
      "202": {
        description:
          "Job accepted — poll `GET /jobs/{jobId}`. **`runId`** is pre-assigned so clients can subscribe to **`GET /v1/runs/{runId}/stream`** while the worker runs.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["jobId", "runId", "sessionId", "projectId", "statusUrl"],
              properties: {
                jobId: { type: "string" },
                runId: { type: "string" },
                sessionId: { type: "string" },
                projectId: { type: "string" },
                statusUrl: { type: "string" },
                pollUrl: { type: "string" },
              },
            },
          },
        },
      },
    });
  } else {
    Object.assign(runPostResponses, {
      "200": {
        description: "Run finished (or waiting)",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                runId: { type: "string" },
                projectId: { type: "string" },
                status: { type: "string" },
                reply: { type: "string" },
                resumeHint: { type: "object" },
              },
            },
          },
        },
      },
      "409": jsonErr("RUN_INVALID_STATE / RUN_CANCELLED"),
      "410": jsonErr("ENGINE_JOB_EXPIRED"),
      "429": jsonErr("LLM_RATE_LIMIT"),
      "502": jsonErr("LLM_TRANSPORT_ERROR / LLM_CLIENT_ERROR / TOOL_EXECUTION_ERROR"),
      "504": jsonErr("RUN_TIMEOUT / TOOL_TIMEOUT"),
      "500": jsonErr("MAX_ITERATIONS_EXCEEDED, other EngineError, or non-engine failure"),
    });
  }

  const paths: Record<string, unknown> = {
    "/agents": {
      get: {
        summary: "List agents",
        tags: ["Agents"],
        parameters: [...tenantParams],
        responses: compactResponses({
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    projectId: { type: "string" },
                    agents: {
                      type: "array",
                      items: { type: "object", properties: { id: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
          "400": jsonErr("Missing projectId (multi-tenant mode)"),
          "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
        }),
      },
    },
    ...(hasMemoryRead
      ? {
          "/agents/{agentId}/memory": {
            get: {
              summary: "Query stored memory by type",
              description:
                "Calls `MemoryAdapter.query` with `MemoryScope` — same partition as `system_save_memory` / `system_get_memory`. **Only when the router has `runtime`.**",
              tags: ["Memory"],
              parameters: [
                { name: "agentId", in: "path", required: true, schema: { type: "string" } },
                {
                  name: "sessionId",
                  in: "query",
                  required: true,
                  schema: { type: "string" },
                },
                {
                  name: "memoryType",
                  in: "query",
                  required: true,
                  schema: { type: "string" },
                  description: "e.g. `working`, `shortTerm`, `longTerm` — adapter-defined",
                },
                {
                  name: "endUserId",
                  in: "query",
                  required: false,
                  schema: { type: "string" },
                  description: "Optional `MemoryScope.endUserId` for partitioned long-term memory",
                },
                ...tenantParams,
              ],
              responses: compactResponses({
                "200": {
                  description: "OK",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["projectId", "agentId", "sessionId", "memoryType", "items"],
                        properties: {
                          projectId: { type: "string" },
                          agentId: { type: "string" },
                          sessionId: { type: "string" },
                          memoryType: { type: "string" },
                          endUserId: { type: "string" },
                          items: { type: "array", items: {} },
                        },
                      },
                    },
                  },
                },
                "400": jsonErr("Missing sessionId or memoryType"),
                "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
                "404": jsonErr("Unknown agent"),
                "500": jsonErr("Adapter or internal error"),
              }),
            },
          },
        }
      : {}),
    ...(hasInterAgentSend
      ? {
          "/agents/{fromAgentId}/send": {
            post: {
              summary: "Send MessageBus message (system_send_message semantics)",
              description:
                "Delivers to **`MessageBus.send`** — same shape as tool **`system_send_message`**. **501** when the router’s **`AgentRuntime`** has no **`config.messageBus`**. Optional **`sendMessageTargetPolicy`** on the runtime can deny targets (**403**).",
              tags: ["Messaging"],
              parameters: [
                { name: "fromAgentId", in: "path", required: true, schema: { type: "string" } },
                ...tenantParams,
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["toAgentId", "payload"],
                      properties: {
                        toAgentId: { type: "string" },
                        payload: { description: "Any JSON value" },
                        type: { type: "string", enum: ["event", "request", "reply"], default: "event" },
                        correlationId: {
                          type: "string",
                          description: "Required when `type` is `request` or `reply`",
                        },
                        sessionId: { type: "string", description: "Optional `AgentMessage.sessionId`" },
                        endUserId: {
                          type: "string",
                          description: "Optional — forwarded to `sendMessageTargetPolicy` only",
                        },
                        ...(multiProject
                          ? {
                              projectId: {
                                type: "string",
                                description: "Ignored for tenancy — use header / query; effective tenant is from router",
                              },
                            }
                          : {}),
                      },
                    },
                  },
                },
              },
              responses: compactResponses({
                "200": {
                  description: "Accepted for delivery",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["projectId", "fromAgentId", "toAgentId", "type", "success"],
                        properties: {
                          projectId: { type: "string" },
                          fromAgentId: { type: "string" },
                          toAgentId: { type: "string" },
                          type: { type: "string" },
                          correlationId: { type: "string" },
                          success: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
                "400": jsonErr("Invalid body (e.g. self-send, missing correlationId for request/reply)"),
                "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
                "403": jsonErr("sendMessageTargetPolicy denied the destination"),
                "404": jsonErr("Unknown sending agent (path)"),
                "501": jsonErr("messageBus missing on AgentRuntime"),
                "500": jsonErr("MessageBus or internal error"),
              }),
            },
          },
        }
      : {}),
    "/agents/{agentId}/run": {
      post: {
        summary: hasDispatch ? "Run agent (enqueue or wait)" : "Run agent (inline)",
        tags: ["Runs"],
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
          ...(hasDispatch
            ? [
                {
                  name: "wait",
                  in: "query",
                  required: false,
                  schema: { type: "string", enum: ["1", "true"] },
                  description: "Block until worker finishes (needs dispatch.queueEvents)",
                },
              ]
            : []),
          ...tenantParams,
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: { type: "string" },
                  sessionId: { type: "string" },
                  expiresAtMs: {
                    type: "number",
                    description: "Absolute Unix ms deadline for the Session used by this request",
                  },
                  extendSessionTtlMs: {
                    type: "number",
                    description:
                      "Extend the Session lifetime by this many ms; applied on top of the later of `expiresAtMs` or now",
                  },
                  ...(multiProject
                    ? {
                        projectId: {
                          type: "string",
                          description: "Tenant for POST when not using header/query",
                        },
                      }
                    : {}),
                  ...(hasDispatch ? { wait: { type: "boolean", description: "Same as ?wait=1" } } : {}),
                },
              },
            },
          },
        },
        responses: runPostResponses,
      },
    },
  };

  const resumeResponses: Record<string, unknown> = {
    "501": { description: "runStore (inline) or queueEvents (wait)" },
    "404": jsonErr("Unknown agent"),
  };
  if (hasDispatch) {
    Object.assign(
      resumeResponses,
      compactResponses({
        "400": jsonErr("Bad request"),
        "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
      }),
    );
    Object.assign(resumeResponses, {
      "200": {
        description: "wait=1 completed",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                jobId: { type: "string" },
                sessionId: { type: "string" },
                projectId: { type: "string" },
                runId: { type: "string" },
                status: { type: "string" },
                reply: { type: "string" },
              },
            },
          },
        },
      },
      "202": {
        description: "Resume job enqueued",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["jobId", "sessionId", "runId", "projectId", "statusUrl"],
              properties: {
                jobId: { type: "string" },
                sessionId: { type: "string" },
                runId: { type: "string" },
                projectId: { type: "string" },
                statusUrl: { type: "string" },
                pollUrl: { type: "string" },
              },
            },
          },
        },
      },
      "502": { description: "Job failed" },
      "503": { description: "Enqueue error" },
      "504": { description: "Wait timeout" },
    });
  } else {
    Object.assign(
      resumeResponses,
      compactResponses({
        "400": jsonErr("Invalid body or non-engine resume failure"),
        "401": hasApiKey
          ? jsonErr("Missing or invalid API key or engine SESSION_EXPIRED")
          : jsonErr("Engine SESSION_EXPIRED"),
      }),
    );
    Object.assign(resumeResponses, {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                runId: { type: "string" },
                projectId: { type: "string" },
                status: { type: "string" },
                reply: { type: "string" },
                resumeHint: { type: "object" },
              },
            },
          },
        },
      },
      "409": jsonErr("RUN_INVALID_STATE / RUN_CANCELLED"),
      "410": jsonErr("ENGINE_JOB_EXPIRED"),
      "429": jsonErr("LLM_RATE_LIMIT"),
      "502": jsonErr("LLM_TRANSPORT_ERROR / LLM_CLIENT_ERROR / TOOL_EXECUTION_ERROR"),
      "504": jsonErr("RUN_TIMEOUT / TOOL_TIMEOUT"),
      "500": jsonErr("MAX_ITERATIONS_EXCEEDED, other EngineError, or non-engine failure"),
    });
  }
  compactResponses(resumeResponses);

  paths["/agents/{agentId}/resume"] = {
    post: {
      summary: hasDispatch ? "Resume run (enqueue or wait)" : "Resume run (inline)",
      tags: ["Runs"],
      parameters: [
        { name: "agentId", in: "path", required: true, schema: { type: "string" } },
        ...(hasDispatch
          ? [
              {
                name: "wait",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["1", "true"] },
              },
            ]
          : []),
        ...tenantParams,
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["runId", "sessionId", "resumeInput"],
              properties: {
                runId: { type: "string" },
                sessionId: { type: "string" },
                expiresAtMs: {
                  type: "number",
                  description: "Absolute Unix ms deadline for the Session used by this resume",
                },
                extendSessionTtlMs: {
                  type: "number",
                  description:
                    "Extend the Session lifetime by this many ms; applied on top of the later of `expiresAtMs` or now",
                },
                ...(multiProject ? { projectId: { type: "string" } } : {}),
                ...(hasDispatch ? { wait: { type: "boolean" } } : {}),
                resumeInput: {
                  type: "object",
                  required: ["type", "content"],
                  properties: {
                    type: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      responses: resumeResponses,
    },
  };

  paths["/agents/{agentId}/continue"] = {
    post: {
      summary: hasDispatch
        ? "Continue completed run (enqueue or wait)"
        : "Continue completed run (inline)",
      description:
        "Append a new user turn to a **completed** run (same **runId**). Not a chat product — a primitive for multi-turn continuity. Requires **runStore**.",
      tags: ["Runs"],
      parameters: [
        { name: "agentId", in: "path", required: true, schema: { type: "string" } },
        ...(hasDispatch
          ? [
              {
                name: "wait",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["1", "true"] },
              },
            ]
          : []),
        ...tenantParams,
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["runId", "sessionId", "message"],
              properties: {
                runId: { type: "string" },
                sessionId: { type: "string" },
                message: { type: "string", description: "Next user message for this run" },
                expiresAtMs: {
                  type: "number",
                  description: "Absolute Unix ms deadline for the Session used by this continue",
                },
                extendSessionTtlMs: {
                  type: "number",
                  description:
                    "Extend the Session lifetime by this many ms; applied on top of the later of `expiresAtMs` or now",
                },
                ...(multiProject ? { projectId: { type: "string" } } : {}),
                ...(hasDispatch ? { wait: { type: "boolean" } } : {}),
              },
            },
          },
        },
      },
      responses: resumeResponses,
    },
  };

  if (hasRunStore) {
    paths["/agents/{agentId}/runs"] = {
      get: {
        summary: "List runs for an agent (RunStore.listByAgent)",
        description:
          "Dashboard-style summaries (`historyStepCount`, optional `reply`) — not a full step log. Rows with **`run.projectId`** set are omitted when it disagrees with the effective tenant. **`RunStore`** indexes by **`agentId`** only (e.g. Redis **`run:agent:{id}`**) — shared stores need globally unique agent ids or per-tenant backends.",
        tags: ["Runs"],
        parameters: [
          { name: "agentId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["running", "waiting", "completed", "failed"] },
          },
          {
            name: "sessionId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "If set, only runs with this `sessionId`",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          ...tenantParams,
        ],
        responses: compactResponses({
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["projectId", "agentId", "limit", "runs"],
                  properties: {
                    projectId: { type: "string" },
                    agentId: { type: "string" },
                    limit: { type: "integer" },
                    runs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          runId: { type: "string" },
                          agentId: { type: "string" },
                          sessionId: { type: "string" },
                          projectId: { type: "string" },
                          status: { type: "string" },
                          iteration: { type: "number" },
                          historyStepCount: { type: "number" },
                          userInput: { type: "string" },
                          reply: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": jsonErr("Invalid status filter"),
          "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
          "404": jsonErr("Unknown agent"),
          "500": jsonErr("RunStore or internal error"),
        }),
      },
    };
    paths["/sessions/{sessionId}/status"] = {
      get: {
        summary: "List all persisted runs for a session (dashboard / playground)",
        description:
          "Unions **`RunStore.listByAgent`** across agents registered for this **`projectId`**, filtered by **`sessionId`**. Use **`?light=1`** to omit per-run **`history`** (still returns **`historyStepCount`** from the resume-aware timeline). Each run’s **`history`** includes synthetic **`observation`** rows after **`wait`** when **`resumeInputs`** exist (same merge as **`?timeline=1`** on **`GET /runs/{runId}`**).",
        tags: ["Sessions"],
        parameters: [
          { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "light",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["0", "1", "true", "false", "yes"] },
            description: "If `1` / `true` / `yes`, omit per-run `history` (smaller payload).",
          },
          ...tenantParams,
        ],
        responses: compactResponses({
          "200": {
            description: "Session id, project id, run rows, and status counts",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sessionId", "projectId", "runs", "summary"],
                  properties: {
                    sessionId: { type: "string" },
                    projectId: { type: "string" },
                    runs: {
                      type: "array",
                      items: {
                        type: "object",
                        description:
                          "Each row includes **`run.sessionId`** (engine session for that run — planner runs differ from the chat `sessionId` in the path).",
                        additionalProperties: true,
                      },
                    },
                    summary: {
                      type: "object",
                      properties: {
                        total: { type: "integer" },
                        byStatus: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": jsonErr("Missing sessionId"),
          "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
          "500": jsonErr("RunStore or internal error"),
          "501": jsonErr("runStore not configured on router"),
        }),
      },
    };
    paths["/runs/{runId}"] = {
      get: {
        summary: "Get run snapshot from RunStore",
        tags: ["Runs"],
        parameters: [
          { name: "runId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "sessionId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "timeline",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["0", "1", "true", "false", "yes"] },
            description:
              "If `1` / `true` / `yes`, include merged `history` (resume text as synthetic observations after each `wait`) and set `historyStepCount` to that timeline length. Also exposes `resumeInputs` / `continueInputs` / `waitReason` when applicable.",
          },
          ...tenantParams,
        ],
        responses: compactResponses({
          "200": {
            description: "Run snapshot (`projectId` when stored on the run — see `@opencoreagents/core` Run)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    agentId: { type: "string" },
                    sessionId: { type: "string" },
                    projectId: { type: "string" },
                    status: { type: "string" },
                    userInput: { type: "string" },
                    resumeInputs: { type: "array", items: { type: "string" } },
                    continueInputs: { type: "array", items: { type: "string" } },
                    waitReason: { type: "string" },
                    reply: { type: "string" },
                    failedReason: {
                      type: "string",
                      description: "Engine error message when `status` is `failed` (persisted on the run).",
                    },
                    iteration: { type: "number" },
                    historyStepCount: { type: "number" },
                    history: { type: "array", items: { type: "object", additionalProperties: true } },
                  },
                },
              },
            },
          },
          "400": jsonErr("Missing sessionId"),
          "401": hasApiKey
            ? jsonErr("Unauthorized or engine SESSION_EXPIRED")
            : jsonErr("Engine SESSION_EXPIRED"),
          "403": jsonErr(
            "sessionId mismatch, effective projectId mismatch vs run.projectId, or engine SECURITY_DENIED / TOOL_NOT_ALLOWED",
          ),
          "404": jsonErr("Run not found"),
          "409": jsonErr("RUN_INVALID_STATE / RUN_CANCELLED"),
          "410": jsonErr("ENGINE_JOB_EXPIRED"),
          "429": jsonErr("LLM_RATE_LIMIT"),
          "502": jsonErr("LLM_TRANSPORT_ERROR / LLM_CLIENT_ERROR / TOOL_EXECUTION_ERROR"),
          "504": jsonErr("RUN_TIMEOUT / TOOL_TIMEOUT"),
          "500": jsonErr("MAX_ITERATIONS_EXCEEDED, other EngineError, or non-engine failure"),
        }),
      },
    };
    paths["/runs/{runId}/history"] = {
      get: {
        summary: "Get run history (Run.history ProtocolMessage[])",
        description:
          "Full step log from **`RunStore`** — same **`?sessionId=`** and **`run.projectId`** vs effective tenant rules as **`GET /runs/{runId}`**. Optional **`?timeline=1`** returns the same resume-aware merge as **`GET /runs/{runId}?timeline=1`** (synthetic observations after each **`wait`**).",
        tags: ["Runs"],
        parameters: [
          { name: "runId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "sessionId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "timeline",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["0", "1", "true", "false", "yes"] },
            description: "If `1` / `true` / `yes`, splice resume text into `history` after each `wait`.",
          },
          ...tenantParams,
        ],
        responses: compactResponses({
          "200": {
            description: "OK — `history` is `ProtocolMessage[]` from `@opencoreagents/core`",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    agentId: { type: "string" },
                    sessionId: { type: "string" },
                    projectId: { type: "string" },
                    status: { type: "string" },
                    history: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
          "400": jsonErr("Missing sessionId"),
          "401": hasApiKey
            ? jsonErr("Unauthorized or engine SESSION_EXPIRED")
            : jsonErr("Engine SESSION_EXPIRED"),
          "403": jsonErr(
            "sessionId mismatch, effective projectId mismatch vs run.projectId, or engine SECURITY_DENIED / TOOL_NOT_ALLOWED",
          ),
          "404": jsonErr("Run not found"),
          "409": jsonErr("RUN_INVALID_STATE / RUN_CANCELLED"),
          "410": jsonErr("ENGINE_JOB_EXPIRED"),
          "429": jsonErr("LLM_RATE_LIMIT"),
          "502": jsonErr("LLM_TRANSPORT_ERROR / LLM_CLIENT_ERROR / TOOL_EXECUTION_ERROR"),
          "504": jsonErr("RUN_TIMEOUT / TOOL_TIMEOUT"),
          "500": jsonErr("MAX_ITERATIONS_EXCEEDED, other EngineError, or non-engine failure"),
        }),
      },
    };
  }

  if (hasDispatch) {
    paths["/jobs/{jobId}"] = {
      get: {
        summary: "Poll BullMQ job (returnvalue Run summary when completed)",
        tags: ["Jobs"],
        parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
        responses: compactResponses({
          "200": { description: "Job state + optional run summary" },
          "401": hasApiKey ? jsonErr("Unauthorized") : undefined,
          "404": jsonErr("Job not found"),
        }),
      },
    };
  }

  const doc: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title,
      version,
      description:
        (description ? `${description}\n\n` : "") +
        "Routes match `createRuntimeRestRouter` from `@opencoreagents/rest-api`. " +
        "Mount the router under a prefix (e.g. `/api`) — paths here are **relative to that mount**.",
    },
    tags: [
      { name: "Agents", description: "Agent listing" },
      ...(hasMemoryRead
        ? [{ name: "Memory", description: "MemoryAdapter read (requires router `runtime`)" }]
        : []),
      ...(hasInterAgentSend
        ? [{ name: "Messaging", description: "MessageBus (requires router `runtime`; 501 without `messageBus`)" }]
        : []),
      { name: "Runs", description: "Run, resume (after wait), and continue (after completed)" },
      ...(hasRunStore
        ? [{ name: "Sessions", description: "Session-scoped run listings (`GET /sessions/{sessionId}/status`)" }]
        : []),
      ...(hasDispatch ? [{ name: "Jobs", description: "BullMQ job polling" }] : []),
    ],
    paths,
  };

  doc.components = {
    schemas: {
      RuntimeRestJsonError: runtimeRestJsonErrorSchema(),
    },
    ...(schemes ? { securitySchemes: schemes } : {}),
  };

  if (security) {
    doc.security = security;
  }

  return doc;
}

/**
 * Minimal Swagger UI page (loads Swagger UI from **unpkg** — no extra npm dependency).
 * `openApiPath` and `uiPath` are the **path segments** on the same router (e.g. `openapi.json`, `docs`).
 */
export function runtimeRestSwaggerUiHtml(openApiPath: string, uiPath: string): string {
  const openFile = JSON.stringify(openApiPath.replace(/^\/+/, ""));
  const uiSeg = JSON.stringify(`/${uiPath.replace(/^\/+/, "").replace(/\/$/, "")}`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Runtime REST API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin="anonymous" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    (function () {
      var openFile = ${openFile};
      var uiSegment = ${uiSeg};
      var pathname = window.location.pathname.replace(/\\/$/, "") || "/";
      var base = pathname.endsWith(uiSegment)
        ? pathname.slice(0, pathname.length - uiSegment.length)
        : pathname;
      var url = (base === "" ? "" : base) + "/" + openFile;
      window.ui = SwaggerUIBundle({
        url: url,
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    })();
  </script>
</body>
</html>`;
}

export interface RuntimeRestSwaggerPaths {
  openApiPath: string;
  uiPath: string;
}

export interface RuntimeRestSwaggerOptions {
  openApiPath?: string;
  uiPath?: string;
  /** Overrides OpenAPI `info` */
  info?: { title?: string; version?: string; description?: string };
  /**
   * After the runtime spec is built, merge or replace paths/components/tags (e.g. host-mounted
   * `/v1/...` definition CRUD) so a single Swagger UI documents the full API surface.
   */
  extendOpenApi?: (spec: Record<string, unknown>) => Record<string, unknown>;
}

export function normalizeRuntimeRestSwaggerPaths(
  swagger: boolean | RuntimeRestSwaggerOptions | undefined,
): RuntimeRestSwaggerPaths | null {
  if (!swagger) return null;
  if (swagger === true) {
    return { openApiPath: "openapi.json", uiPath: "docs" };
  }
  return {
    openApiPath: (swagger.openApiPath ?? "openapi.json").replace(/^\/+/, ""),
    uiPath: (swagger.uiPath ?? "docs").replace(/^\/+/, "").replace(/\/$/, ""),
  };
}

export function runtimeRestSwaggerInfo(
  swagger: boolean | RuntimeRestSwaggerOptions | undefined,
): RuntimeRestSwaggerOptions["info"] | undefined {
  if (!swagger || swagger === true) return undefined;
  return swagger.info;
}
