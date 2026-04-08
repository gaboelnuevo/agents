export interface RuntimeConfig {
  adapters: {
    memory: {
      type: "upstash-redis" | "redis" | "memory";
      url?: string;
      token?: string;
    };
    vector?: {
      type: "upstash-vector";
      url?: string;
      token?: string;
    };
    jobQueue?: {
      type: "bullmq" | "qstash";
      connection?: string;
    };
  };
  llm: {
    provider: string;
    model: string;
    apiKey: string;
  };
  security: {
    enabled: boolean;
    defaultRoles: string[];
  };
  limits: {
    maxIterations: number;
    runTimeoutMs: number;
  };
  /**
   * Passed to `AgentRuntime`: intersects with each agent’s tool allowlist.
   * Omit or `"*"` for no extra restriction (default).
   */
  allowedToolIds?: readonly string[] | "*";
}
