import type { AgentDefinitionPersisted } from "./types.js";
import { Session } from "./Session.js";
import { getAgentDefinition, registerAgentDefinition } from "./registry.js";
import { RunBuilder } from "./RunBuilder.js";
export interface AgentInstance {
  id: string;
  run(input: string): RunBuilder;
  resume(
    runId: string,
    input: { type: string; content: string },
  ): RunBuilder;
}

class AgentInstanceImpl implements AgentInstance {
  readonly id: string;

  constructor(
    private readonly def: AgentDefinitionPersisted,
    private readonly session: Session,
  ) {
    this.id = def.id;
  }

  run(input: string): RunBuilder {
    return new RunBuilder(this.def, this.session, input);
  }

  resume(
    runId: string,
    input: { type: string; content: string },
  ): RunBuilder {
    return new RunBuilder(this.def, this.session, { runId, resumeInput: input });
  }
}

export class Agent {
  static async define(def: AgentDefinitionPersisted): Promise<void> {
    registerAgentDefinition(def);
  }

  static async load(
    agentId: string,
    opts: { session: Session },
  ): Promise<AgentInstance> {
    const def = getAgentDefinition(opts.session.projectId, agentId);
    if (!def) {
      throw new Error(`Agent not found: ${agentId} (project ${opts.session.projectId})`);
    }
    if (!def.llm?.provider || !def.llm?.model) {
      throw new Error(`Agent ${agentId} is missing llm.provider / llm.model`);
    }
    return new AgentInstanceImpl(def, opts.session);
  }
}
