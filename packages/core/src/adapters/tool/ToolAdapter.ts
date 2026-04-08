import type { MemoryAdapter } from "../memory/MemoryAdapter.js";
import type { SecurityContext } from "../../security/types.js";

export interface ToolContext {
  projectId: string;
  agentId: string;
  runId: string;
  sessionId: string;
  endUserId?: string;
  memoryAdapter: MemoryAdapter;
  securityContext: SecurityContext;
}

export interface ToolAdapter {
  name: string;
  description?: string;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
  validate?(input: unknown): boolean;
}

export interface ObservationContent {
  success: boolean;
  data?: unknown;
  error?: string;
}
