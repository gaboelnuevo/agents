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
  /**
   * Tenant that owns this run — set when created via {@link createRun} / {@link Agent.run}.
   * Used by HTTP layers (e.g. `GET /runs`) to reject cross-tenant reads when present.
   * Older persisted runs may omit this until the next resume.
   */
  projectId?: string;
  status: RunStatus;
  history: ProtocolMessage[];
  state: {
    iteration: number;
    pending: null | { reason: string; details?: unknown };
    parseAttempts?: number;
    /** Latest user text for this run (first turn). */
    userInput?: string;
    /**
     * Text from each **`resume`** after a **`wait`** (HTTP or in-process), in order — not duplicated in **`history`**.
     */
    resumeInputs?: string[];
    /**
     * Text from each **`continue`** (new user turn on a **`completed`** run), in order — not duplicated in **`history`**.
     */
    continueInputs?: string[];
    /**
     * Last engine error message when **`status`** was persisted as **`failed`** (set in {@link RunBuilder} catch).
     */
    failedReason?: string;
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
