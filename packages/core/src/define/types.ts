import type { MemoryAdapter } from "../adapters/memory/MemoryAdapter.js";

export interface AgentDefinition {
  id: string;
  systemPrompt: string;
  skills?: string[];
  tools?: string[];
  memoryConfig?: Record<string, unknown>;
  llm?: { provider: string; model: string; [key: string]: unknown };
}

export interface AgentDefinitionPersisted extends AgentDefinition {
  name?: string;
  projectId?: string;
  defaultMemory?: Record<string, unknown>;
  security?: { roles?: string[]; scopes?: string[] };
}

export interface ToolDefinition {
  id: string;
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scope?: "global";
  projectId?: string;
  roles?: string[];
}

export interface SkillDefinition {
  id: string;
  name?: string;
  scope?: "global";
  projectId?: string;
  tools: string[];
  description?: string;
  roles?: string[];
  execute?: SkillExecute;
}

export type SkillExecute = (args: {
  input: unknown;
  context: {
    agentId: string;
    runId: string;
    memory: MemoryAdapter;
    invokeTool: (name: string, input: unknown) => Promise<unknown>;
  };
}) => Promise<unknown>;
