export interface MemoryScope {
  projectId: string;
  agentId: string;
  sessionId: string;
  endUserId?: string;
}

export interface MemoryAdapter {
  save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void>;
  query(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<unknown[]>;
  delete(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<void>;
  getState(scope: MemoryScope): Promise<unknown>;
}
