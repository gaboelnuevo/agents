/** "cancelled" is not a distinct status — cancellation sets "failed" with RunCancelledError. */
export type RunStatus = "running" | "waiting" | "completed" | "failed";

export type Step =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; input: unknown }
  | { type: "wait"; reason: string; details?: unknown }
  | { type: "result"; content: string };

export interface ProtocolMessage {
  type: "thought" | "action" | "observation" | "wait" | "result";
  content: unknown;
  meta: {
    ts: string;
    source: "llm" | "engine" | "tool";
  };
}

export interface Run {
  runId: string;
  agentId: string;
  sessionId?: string;
  status: RunStatus;
  history: ProtocolMessage[];
  state: {
    iteration: number;
    pending: null | { reason: string; details?: unknown };
    parseAttempts?: number;
    /** Latest user text for this run (first turn). */
    userInput?: string;
    [key: string]: unknown;
  };
}

export interface RunEnvelope {
  id: string;
  agentId: string;
  sessionId?: string;
  messages: ProtocolMessage[];
  state: Record<string, unknown>;
  tools: string[];
  status: RunStatus;
}
