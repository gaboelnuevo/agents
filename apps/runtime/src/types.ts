/**
 * Declarative stack settings loaded from YAML or JSON files.
 * Committed templates: `config/*.example.yaml` (including `docker.stack.example.yaml`, default in image/Compose). Operational stacks: `local.yaml`, `docker.stack.yaml`, `cloud.yaml`, etc. — gitignored under `config/*.yaml`.
 */
export type RuntimeEnvironmentKind = "local" | "cloud";

/** Provider id matching `agent.llm.provider` in definitions (`openai`, `anthropic`). */
export type LlmDriverKind = "openai" | "anthropic";

export interface RuntimeLlmFileConfig {
  /** Which adapter is the runtime default when resolving LLM calls. */
  defaultProvider?: LlmDriverKind;
  openai?: {
    apiKey?: string;
    baseUrl?: string;
  };
  anthropic?: {
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface ResolvedLlmStackConfig {
  defaultProvider: LlmDriverKind;
  openai: { apiKey: string; baseUrl: string };
  anthropic: { apiKey: string; baseUrl: string };
}

export interface RuntimeStackFileConfig {
  /** Hint for operators; not read by workers, useful in logs or docs. */
  environment?: RuntimeEnvironmentKind;
  server?: {
    port?: number;
    host?: string;
  };
  project?: {
    id?: string;
  };
  redis?: {
    /** Supports placeholders such as `${REDIS_URL}` or `${REDIS_URL:-redis://127.0.0.1:6379}`. */
    url?: string;
  };
  bullmq?: {
    /** Empty string omits ENGINE_QUEUE_NAME (library default). */
    queueName?: string;
  };
  definitions?: {
    keyPrefix?: string;
  };
  run?: {
    waitTimeoutMs?: number;
  };
  openclaw?: {
    enabled?: boolean;
    /** Relative paths resolve from the config file’s directory. */
    skillsDirs?: string[];
  };
  llm?: RuntimeLlmFileConfig;
}

export interface ResolvedRuntimeStackConfig {
  environment: RuntimeEnvironmentKind;
  server: { port: number; host: string };
  project: { id: string };
  redis: { url: string };
  bullmq: { queueName: string | undefined };
  definitions: { keyPrefix: string };
  run: { waitTimeoutMs: number };
  openclaw: { enabled: boolean; skillsDirs: string[] };
  llm: ResolvedLlmStackConfig;
}
