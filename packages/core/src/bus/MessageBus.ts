export interface AgentMessage {
  id: string;
  correlationId?: string;
  fromAgentId: string;
  toAgentId: string;
  projectId: string;
  sessionId?: string;
  type: "request" | "reply" | "event";
  payload: unknown;
  meta?: { ts: string };
}

export interface MessageBus {
  send(msg: Omit<AgentMessage, "id">): Promise<void>;
  waitFor(
    agentId: string,
    filter: { correlationId?: string; fromAgentId?: string },
    options?: { timeoutMs?: number },
  ): Promise<AgentMessage>;
}
