import type { ToolAdapter, ToolContext } from "../adapters/tool/ToolAdapter.js";
import { registerToolDefinition, registerToolHandler } from "../define/registry.js";

const MAX_TO_AGENT_ID_LEN = 256;
const MAX_CORRELATION_ID_LEN = 256;

function isMessageType(v: unknown): v is "request" | "reply" | "event" {
  return v === "request" || v === "reply" || v === "event";
}

const sendMessage: ToolAdapter = {
  name: "send_message",
  description:
    "Sends a message to another agent in the same project. " +
    "Supports fire-and-forget events and request-reply patterns.",
  validate(input: unknown): boolean {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const o = input as Record<string, unknown>;
    if (typeof o.toAgentId !== "string") return false;
    const to = o.toAgentId.trim();
    if (to.length === 0 || o.toAgentId.length > MAX_TO_AGENT_ID_LEN) return false;
    if (!("payload" in o)) return false;
    const t = o.type;
    if (t !== undefined && !isMessageType(t)) return false;
    if (t === "request" || t === "reply") {
      if (typeof o.correlationId !== "string") return false;
      const c = o.correlationId.trim();
      if (c.length === 0 || o.correlationId.length > MAX_CORRELATION_ID_LEN) return false;
    }
    if (o.correlationId !== undefined && typeof o.correlationId !== "string") return false;
    if (
      typeof o.correlationId === "string" &&
      o.correlationId.length > MAX_CORRELATION_ID_LEN
    )
      return false;
    return true;
  },
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      toAgentId: string;
      type?: "request" | "reply" | "event";
      payload: unknown;
      correlationId?: string;
    };
    const toId = o.toAgentId.trim();
    if (toId === ctx.agentId) {
      throw new Error("send_message: toAgentId cannot match the sending agent");
    }
    const policy = ctx.sendMessageTargetPolicy;
    if (
      policy &&
      !policy({
        fromAgentId: ctx.agentId,
        toAgentId: toId,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        endUserId: ctx.endUserId,
      })
    ) {
      throw new Error("send_message: target agent is not allowed for this sender");
    }
    const bus = ctx.messageBus;
    if (!bus) {
      throw new Error(
        "messageBus is required for send_message. Pass it via AgentRuntime({ messageBus }).",
      );
    }
    await bus.send({
      fromAgentId: ctx.agentId,
      toAgentId: toId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      type: o.type ?? "event",
      payload: o.payload,
      correlationId:
        typeof o.correlationId === "string" ? o.correlationId.trim() : undefined,
      meta: { ts: new Date().toISOString() },
    });
    return { success: true, sentTo: toId };
  },
};

export function registerSendMessageToolHandler(): void {
  registerToolDefinition({
    id: "send_message",
    scope: "global",
    description: sendMessage.description!,
    inputSchema: {
      type: "object",
      properties: {
        toAgentId: { type: "string", description: "Target agent ID" },
        type: { enum: ["request", "reply", "event"] },
        payload: { description: "Message payload" },
        correlationId: { type: "string", description: "Correlation ID for request-reply" },
      },
      required: ["toAgentId", "payload"],
    },
    roles: ["agent"],
  });
  registerToolHandler(sendMessage);
}
