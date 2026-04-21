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
    /**
     * OpenAI-compatible API base URL (Azure, proxies, etc.). Wired into the worker’s {@link AgentRuntime}
     * adapter — applies to **every** agent with `llm.provider: "openai"`, including sub-agents created by
     * `spawn_agent` (definitions only store `provider` + `model`, not the URL).
     */
    baseUrl?: string;
  };
  anthropic?: {
    apiKey?: string;
    /**
     * Anthropic API base override when required. Same idea as {@link RuntimeLlmFileConfig.openai.baseUrl}:
     * one adapter per worker for all `llm.provider: "anthropic"` runs, planner sub-agents included.
     */
    baseUrl?: string;
  };
}

export interface ResolvedLlmStackConfig {
  defaultProvider: LlmDriverKind;
  openai: { apiKey: string; baseUrl: string };
  anthropic: { apiKey: string; baseUrl: string };
}

export type VectorDistanceMetricKind = "COSINE" | "L2" | "IP";

export interface RuntimeVectorFileConfig {
  /** Enable `embeddingAdapter` + `vectorAdapter` wiring on `AgentRuntime`. */
  enabled?: boolean;
  openai?: {
    /** Embedding model id used by `OpenAIEmbeddingAdapter`. */
    embeddingModel?: string;
  };
  /** Redis Stack `FT.CREATE` index name prefix. */
  indexPrefix?: string;
  /** Redis key prefix for vector HASH documents. */
  keyPrefix?: string;
  /** Distance metric used by RediSearch vector field. */
  distanceMetric?: VectorDistanceMetricKind;
  /** Expansion factor when a metadata filter is present (post-filtering). */
  queryExpansionFactor?: number;
}

export interface ResolvedRuntimeVectorStackConfig {
  enabled: boolean;
  openai: { embeddingModel: string };
  indexPrefix: string;
  keyPrefix: string;
  distanceMetric: VectorDistanceMetricKind;
  queryExpansionFactor: number;
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
  /**
   * When **`redis: true`** (or **`RUNTIME_RUN_EVENTS_REDIS=1`**), the worker publishes JSON per step to Redis Pub/Sub
   * and the API exposes **`GET /v1/runs/:runId/stream?sessionId=`** (SSE). Chat UI stays outside; this is a wire for notifications.
   */
  runEvents?: {
    redis?: boolean;
  };
  openclaw?: {
    enabled?: boolean;
    /** Relative paths resolve from the config file’s directory. */
    skillsDirs?: string[];
  };
  artifacts?: {
    enabled?: boolean;
    /** Relative paths resolve from the config file’s directory. */
    rootDir?: string;
    /** Optional public base URL prepended to the saved relative path. */
    publicBaseUrl?: string;
  };
  llm?: RuntimeLlmFileConfig;
  vector?: RuntimeVectorFileConfig;
  /**
   * Dynamic planner (`spawn_agent` default LLM when the tool omits `llm`).
   * Omit to infer provider from configured API keys + `llm.defaultProvider`, and use conservative default model ids.
   * **HTTP endpoint** for LLM calls is **not** set here: it comes from `llm.openai.baseUrl` / `llm.anthropic.baseUrl`
   * on the worker (see {@link RuntimeLlmFileConfig}).
   */
  planner?: {
    /**
     * Seed a built-in orchestrator agent in Redis on startup if missing (`DEFAULT_PLANNER_SYSTEM_PROMPT` + planner tools).
     * Disable with `enabled: false` or env `RUNTIME_PLANNER_DEFAULT_AGENT=0`.
     */
    defaultAgent?: {
      enabled?: boolean;
      /** Agent id (default `planner`). */
      id?: string;
      llm?: {
        provider?: LlmDriverKind | "auto";
        model?: string;
        temperature?: number;
      };
    };
    subAgent?: {
      /**
       * `openai` | `anthropic` selects which runtime adapter (and thus which `baseUrl` / API key) is used; omit or **`auto`** → infer from API keys + `llm.defaultProvider`.
       */
      provider?: LlmDriverKind | "auto";
      /**
       * Model id **as understood by that endpoint**. Omit or **`auto`** → conservative defaults; with a custom
       * gateway, set an explicit model name your proxy exposes (or `RUNTIME_PLANNER_SUB_AGENT_MODEL`).
       */
      model?: string;
      /** Omit → `0.2`. */
      temperature?: number;
    };
  };
  /**
   * Default **`chat`** agent for **`POST /v1/chat`**: created in Redis the **first time** that endpoint is used
   * (not at boot). Uses **`invoke_planner`** + memory tools; planner completion is pushed to **`/v1/chat/stream`**
   * when **`runEvents.redis`** is enabled.
   */
  chat?: {
    defaultAgent?: {
      enabled?: boolean;
      /** Agent id (default `chat`). */
      id?: string;
      llm?: {
        provider?: LlmDriverKind | "auto";
        model?: string;
        temperature?: number;
      };
    };
  };
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
  artifacts: { enabled: boolean; rootDir: string; publicBaseUrl: string };
  llm: ResolvedLlmStackConfig;
  vector: ResolvedRuntimeVectorStackConfig;
  planner: {
    defaultAgent: {
      enabled: boolean;
      id: string;
      llm: {
        provider?: LlmDriverKind;
        model?: string;
        temperature?: number;
      };
    };
    subAgent: {
      provider?: LlmDriverKind;
      model?: string;
      temperature?: number;
    };
  };
  runEvents: { redis: boolean };
  chat: {
    defaultAgent: {
      enabled: boolean;
      id: string;
      llm: {
        provider?: LlmDriverKind;
        model?: string;
        temperature?: number;
      };
    };
  };
}
