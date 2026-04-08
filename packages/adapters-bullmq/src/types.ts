/**
 * Job payloads for BullMQ workers that drive the same entry points as the SDK:
 * {@link Agent.run} and {@link Agent.resume}.
 */
export type EngineResumeInput = { type: string; content: string };

export type EngineRunJobPayload = {
  kind: "run";
  projectId: string;
  agentId: string;
  sessionId: string;
  /** When set, forwarded to {@link Session} for B2B2C memory (`longTerm` / `vectorMemory` scoping). */
  endUserId?: string;
  /** When set, `dispatchEngineJob` throws if `Date.now()` exceeds this (Unix ms). */
  expiresAtMs?: number;
  /** Forwarded to `Session` for sandboxed `file_read` / `file_ingest` local paths. */
  fileReadRoot?: string;
  allowFileReadOutsideRoot?: boolean;
  allowHttpFileSources?: boolean;
  httpFileSourceHostsAllowlist?: string[];
  userInput: string;
};

export type EngineResumeJobPayload = {
  kind: "resume";
  projectId: string;
  agentId: string;
  sessionId: string;
  /** When set, forwarded to {@link Session} for B2B2C memory (`longTerm` / `vectorMemory` scoping). */
  endUserId?: string;
  /** When set, `dispatchEngineJob` throws if `Date.now()` exceeds this (Unix ms). */
  expiresAtMs?: number;
  fileReadRoot?: string;
  allowFileReadOutsideRoot?: boolean;
  allowHttpFileSources?: boolean;
  httpFileSourceHostsAllowlist?: string[];
  runId: string;
  resumeInput: EngineResumeInput;
};

export type EngineJobPayload = EngineRunJobPayload | EngineResumeJobPayload;
