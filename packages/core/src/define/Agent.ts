import type { AgentDefinitionPersisted } from "./types.js";
import { Session } from "./Session.js";
import { getAgentDefinition, registerAgentDefinition } from "./registry.js";
import { RunBuilder } from "./RunBuilder.js";
import type { AgentRuntime } from "../runtime/AgentRuntime.js";

export interface AgentInstance {
  id: string;
  run(input: string, options?: { runId?: string }): RunBuilder;
  resume(
    runId: string,
    input: { type: string; content: string },
  ): RunBuilder;
  /** New user turn on a **`completed`** or **`failed`** run (same **`runId`**). Requires **`runStore`**. */
  continueRun(runId: string, userInput: string): RunBuilder;
}

class AgentInstanceImpl implements AgentInstance {
  readonly id: string;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly def: AgentDefinitionPersisted,
    private readonly session: Session,
  ) {
    this.id = def.id;
  }

  run(input: string, options?: { runId?: string }): RunBuilder {
    if (options?.runId !== undefined && options.runId !== "") {
      return new RunBuilder(this.runtime, this.def, this.session, {
        userInput: input,
        runId: options.runId,
      });
    }
    return new RunBuilder(this.runtime, this.def, this.session, input);
  }

  resume(
    runId: string,
    input: { type: string; content: string },
  ): RunBuilder {
    return new RunBuilder(this.runtime, this.def, this.session, { runId, resumeInput: input });
  }

  continueRun(runId: string, userInput: string): RunBuilder {
    return new RunBuilder(this.runtime, this.def, this.session, {
      runId,
      continueUserInput: userInput,
    });
  }
}

export class Agent {
  static async define(def: AgentDefinitionPersisted): Promise<void> {
    registerAgentDefinition(def);
  }

  static async load(
    agentId: string,
    runtime: AgentRuntime,
    opts: { session: Session },
  ): Promise<AgentInstance> {
    const def = getAgentDefinition(opts.session.projectId, agentId);
    if (!def) {
      throw new Error(`Agent not found: ${agentId} (project ${opts.session.projectId})`);
    }
    if (!def.llm?.provider || !def.llm?.model) {
      throw new Error(`Agent ${agentId} is missing llm.provider / llm.model`);
    }
    return new AgentInstanceImpl(runtime, def, opts.session);
  }
}
