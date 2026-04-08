import { Agent, Session } from "@agent-runtime/core";
import type { Run } from "@agent-runtime/core";
import type { EngineJobPayload } from "./types.js";

/**
 * Loads the agent and executes **`run`** or **`resume`** for a validated {@link EngineJobPayload}.
 * Use inside a BullMQ {@link Worker} `processor` after `configureRuntime` and `Agent.define` on the worker process.
 */
export async function dispatchEngineJob(payload: EngineJobPayload): Promise<Run> {
  const session = new Session({ id: payload.sessionId, projectId: payload.projectId });
  const agent = await Agent.load(payload.agentId, { session });
  if (payload.kind === "run") {
    return await agent.run(payload.userInput);
  }
  return await agent.resume(payload.runId, payload.resumeInput);
}
