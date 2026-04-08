import {
  Agent,
  Session,
  EngineJobExpiredError,
  type AgentRuntime,
  type Run,
} from "@agent-runtime/core";
import type { EngineJobPayload } from "./types.js";

function throwIfJobExpired(payload: EngineJobPayload): void {
  const deadline = payload.expiresAtMs;
  if (deadline != null && Number.isFinite(deadline) && Date.now() > deadline) {
    throw new EngineJobExpiredError("Engine job expired (expiresAtMs)");
  }
}

/**
 * Loads the agent and executes **`run`** or **`resume`** for a validated {@link EngineJobPayload}.
 * Use inside a BullMQ {@link Worker} `processor` after constructing an {@link AgentRuntime}
 * (same adapters as the API process) and `Agent.define` on the worker process.
 */
export async function dispatchEngineJob(
  runtime: AgentRuntime,
  payload: EngineJobPayload,
): Promise<Run> {
  throwIfJobExpired(payload);
  const session = new Session({
    id: payload.sessionId,
    projectId: payload.projectId,
    endUserId: payload.endUserId,
    fileReadRoot: payload.fileReadRoot,
    allowFileReadOutsideRoot: payload.allowFileReadOutsideRoot,
    allowHttpFileSources: payload.allowHttpFileSources,
    httpFileSourceHostsAllowlist: payload.httpFileSourceHostsAllowlist,
  });
  const agent = await Agent.load(payload.agentId, runtime, { session });
  if (payload.kind === "run") {
    return await agent.run(payload.userInput);
  }
  return await agent.resume(payload.runId, payload.resumeInput);
}
