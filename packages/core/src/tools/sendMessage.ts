import type { ToolAdapter, ToolContext } from "../adapters/tool/ToolAdapter.js";
import type { MessageBus } from "../bus/MessageBus.js";
import { registerToolDefinition, registerToolHandler } from "../define/registry.js";

const sendMessage: ToolAdapter = {
  name: "send_message",
  description:
    "Sends a message to another agent in the same project. " +
    "Supports fire-and-forget events and request-reply patterns.",
  async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
    const o = input as {
      toAgentId: string;
      type?: "request" | "reply" | "event";
      payload: unknown;
      correlationId?: string;
    };
    const bus = (ctx as Record<string, unknown>).messageBus as
      | MessageBus
      | undefined;
    if (!bus) {
      throw new Error(
        "messageBus is required for send_message. Pass it via configureRuntime().",
      );
    }
    await bus.send({
      fromAgentId: ctx.agentId,
      toAgentId: o.toAgentId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      type: o.type ?? "event",
      payload: o.payload,
      correlationId: o.correlationId,
      meta: { ts: new Date().toISOString() },
    });
    return { success: true, sentTo: o.toAgentId };
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
