/**
 * Merges **`/v1/chat`** (and optional **`/v1/chat/stream`**) into the plan REST OpenAPI document.
 */

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

export type ExtendOpenApiWithChatOptions = {
  /** When true, documents **`GET /v1/chat/stream`** (requires **`runEvents.redis`** at runtime). */
  includePlannerNotifyStream: boolean;
};

export function extendOpenApiWithChat(
  spec: Record<string, unknown>,
  opts: ExtendOpenApiWithChatOptions,
): Record<string, unknown> {
  const paths = { ...((spec.paths as Record<string, unknown>) ?? {}) };
  const tags = [...((spec.tags as Array<Record<string, unknown>>) ?? [])];

  tags.push({
    name: "Chat",
    description:
      "Session chat with the stack’s default chat agent. Same `REST_API_KEY` as plan REST when set. Requires `chat.defaultAgent` (disable with `RUNTIME_CHAT_DEFAULT_AGENT=off`).",
  });

  paths["/v1/chat"] = {
    post: {
      summary: "Send a chat message",
      description:
        "Creates or continues a session-bound run. Omit **`sessionId`** to start a new session (response includes one). Follow-up messages use **`continue`** on the same **`runId`** when the stored run is **`completed`** or **`failed`** (failed runs resume with full prior context). Use **`wait`** in the JSON body or **`?wait=1`** to block until the **entire** chat job completes (all model tool rounds); omit **`wait`** for **202** + **`jobId`** / **`pollUrl`**. If a previous chat job for this session is still **running** or **waiting**, the endpoint returns **200** with an inline progress reply instead of enqueueing another job.",
      tags: ["Chat"],
      parameters: [
        {
          name: "wait",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["0", "1", "true", "false"] },
          description: "If `1` or `true`, wait for completion (same as body `wait: true`).",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: {
                message: { type: "string", description: "User message text." },
                sessionId: {
                  type: "string",
                  description: "Existing session id from a prior call; omit for a new session.",
                },
                wait: {
                  type: "boolean",
                  description: "Wait for the engine job to finish before responding.",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Run finished inline (`wait`); may include **`reply`** when the assistant produced final text.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                properties: {
                  jobId: { type: "string" },
                  sessionId: { type: "string" },
                  projectId: { type: "string" },
                  runId: { type: "string" },
                  agentId: { type: "string" },
                  status: { type: "string" },
                  reply: { type: "string" },
                },
              },
            },
          },
        },
        "202": {
          description: "Job enqueued; poll **`GET /jobs/:jobId`** or use **`pollUrl`**.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                properties: {
                  jobId: { type: "string" },
                  sessionId: { type: "string" },
                  projectId: { type: "string" },
                  runId: { type: "string" },
                  agentId: { type: "string" },
                  statusUrl: { type: "string" },
                  pollUrl: { type: "string" },
                },
              },
            },
          },
        },
        "400": jsonErr("Missing **`message`** or validation error"),
        "401": jsonErr("Missing or invalid API key"),
        "500": jsonErr("Server or enqueue error"),
        "502": jsonErr("Job failed while waiting"),
        "503": jsonErr("Chat disabled or dependency error"),
        "504": jsonErr("Wait timeout"),
      },
    },
  };

  if (opts.includePlannerNotifyStream) {
    paths["/v1/chat/stream"] = {
      get: {
        summary: "SSE: planner completion notifications",
        description:
          "Server-Sent Events on the Redis channel for this **`sessionId`** when a planner job started via **`invoke_planner`** finishes. Requires a prior **`POST /v1/chat`** for the same session and **`runEvents.redis`** enabled on API and worker.",
        tags: ["Chat"],
        parameters: [
          {
            name: "sessionId",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Chat session id returned from **`POST /v1/chat`**.",
          },
        ],
        responses: {
          "200": {
            description:
              "Stream of `event: chat` with JSON lines (e.g. **`planner_invocation_finished`**).",
            content: {
              "text/event-stream": {
                schema: { type: "string", description: "SSE body (`event:` / `data:` lines)." },
              },
            },
          },
          "400": jsonErr("Missing **`sessionId`** query"),
          "401": jsonErr("Missing or invalid API key"),
          "404": jsonErr("Unknown session (no binding yet)"),
        },
      },
    };
  }

  const info = { ...((spec.info as Record<string, unknown>) ?? {}) };
  const baseDesc = String(info.description ?? "");
  if (!baseDesc.includes("/v1/chat")) {
    const note =
      "Chat: see tag **Chat** (`POST /v1/chat`" +
      (opts.includePlannerNotifyStream ? ", `GET /v1/chat/stream`" : "") +
      ").";
    info.description = baseDesc + (baseDesc.trim() ? "\n\n" : "") + note;
  }

  return { ...spec, paths, tags, info };
}
