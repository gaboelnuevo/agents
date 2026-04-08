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
  userInput: string;
};

export type EngineResumeJobPayload = {
  kind: "resume";
  projectId: string;
  agentId: string;
  sessionId: string;
  runId: string;
  resumeInput: EngineResumeInput;
};

export type EngineJobPayload = EngineRunJobPayload | EngineResumeJobPayload;
