# Scaffold: internal code-generation blueprint

> **Purpose** — Single source of truth to generate the entire `@agent-runtime` codebase from the `docs/core/` specifications. This document consolidates every interface, type, enum, module boundary, file path, dependency, and implementation contract into one actionable reference. It is NOT about CLI project scaffolding (see `docs/core/18-scaffold.md` for that).

### Relationship to `docs/core/18-scaffold.md`

| Document | Audience | Contents |
|----------|----------|----------|
| **`docs/scaffold.md` (this file)** | Implementers of the monorepo | Turborepo layout, **all** `packages/*` boundaries, dependency graph, canonical types, implementation phases, testing matrix. |
| **`docs/core/18-scaffold.md`** | Users of the product CLI / programmatic API | `init` / `generate` commands, flags, generated **end-user** project layout, post-scaffold checklist. |

End-user “what files appear in `my-project/`” belongs in `18-scaffold`. Monorepo “what files belong in `packages/cli/` vs `packages/scaffold/`” belongs here.

---

## 0. Monorepo: Turborepo

The codebase is a **Turborepo** monorepo. All packages live under `packages/`, share a root `turbo.json` pipeline, and use **pnpm workspaces**.

### 0.1 Root files

```
agent-runtime/                    → repo root
├── turbo.json                    → pipeline definitions
├── package.json                  → pnpm workspaces + root scripts + devDependencies
├── pnpm-workspace.yaml           → workspace glob
├── pnpm-lock.yaml
├── tsconfig.base.json            → shared compiler options (all packages extend this)
├── .eslintrc.js                  → shared lint config (or eslint.config.mjs for flat config)
├── .prettierrc                   → shared formatting
├── .gitignore
├── .env.example                  → root env template (copied per deploy)
├── vitest.workspace.ts           → optional unified test config (see §15)
└── packages/
```

### 0.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### 0.3 Root `package.json`

```jsonc
{
  "name": "agent-runtime",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build":     "turbo run build",
    "dev":       "turbo run dev",
    "test":      "turbo run test",
    "test:ci":   "turbo run test --concurrency=1",
    "lint":      "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean":     "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo":       "^2",
    "typescript":  "^5.7",
    "vitest":      "^3",
    "eslint":      "^9",
    "prettier":    "^3",
    "@types/node": "^22",
    "tsup":        "^8"
  }
}
```

### 0.4 `turbo.json`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": [],
      "inputs": ["src/**", "tests/**", "vitest.config.*"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "clean": {
      "cache": false,
      "outputs": []
    }
  }
}
```

### 0.5 `tsconfig.base.json` (shared)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist"]
}
```

### 0.6 Per-package conventions

Every package under `packages/` follows this structure:

| File | Purpose |
|------|---------|
| `package.json` | Name scoped `@agent-runtime/*`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, `"exports"` field, internal `"dependencies"` via `"workspace:*"`. `tsup` and `typescript` are root `devDependencies` — do not duplicate in per-package `devDependencies`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`, sets local `include`/`outDir` |
| `tsup.config.ts` | Build with `tsup` → `dist/`, format `esm` + `cjs`, `dts: true` |
| `vitest.config.ts` | Per-package test config (optional, can use root) |
| `src/index.ts` | Barrel export |
| `src/` | Source code |
| `tests/` | Test files (`*.test.ts`) |

Per-package `package.json` template:

```jsonc
{
  "name": "@agent-runtime/PACKAGE_NAME",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build":     "tsup",
    "dev":       "tsup --watch",
    "test":      "vitest run",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src/",
    "clean":     "rm -rf dist"
  },
  "dependencies": {}
}
```

Per-package `tsconfig.json` template:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Per-package `tsup.config.ts` template:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

### 0.7 Internal dependency graph

Packages reference each other with `"workspace:*"` in `dependencies`:

```
@agent-runtime/core              → no internal deps (pure interfaces + engine + built-in tools)
@agent-runtime/utils             → no internal deps (pure functions)
@agent-runtime/adapters-redis    → depends on @agent-runtime/core (interfaces); TCP Redis via ioredis (preferred for shared memory / RunStore / MessageBus)
@agent-runtime/adapters-upstash  → depends on @agent-runtime/core (interfaces); REST Redis + Upstash Vector
@agent-runtime/adapters-bullmq   → depends on @agent-runtime/core + **bullmq** — **priority** job queue (`createEngineQueue`, `createEngineWorker`, `dispatchEngineJob`)
@agent-runtime/adapters-openai   → depends on @agent-runtime/core (interfaces)
@agent-runtime/rag               → depends on @agent-runtime/core, @agent-runtime/utils (RAG tools that need parsers/chunking)
@agent-runtime/cli               → depends on @agent-runtime/core, @agent-runtime/scaffold
@agent-runtime/scaffold          → depends on @agent-runtime/core
```

RAG tools that import utils (e.g. `file_ingest`, `file_read`) live in `@agent-runtime/rag` to keep `core` free of internal dependencies. Built-in tools that only need `MemoryAdapter` (`save_memory`, `get_memory`, `update_state`) and vector tools that only need adapter interfaces (`vector_search`, `vector_upsert`, `vector_delete`) remain in `core`.

Turborepo `^build` in `dependsOn` ensures transitive builds run in correct order.

### 0.8 Per-package inventory (all workspace packages)

Nine packages under `packages/`. Edges match §0.7; **status** reflects this repository (incremental implementation).

| Package | Role | `workspace:*` deps | Status (typical) |
|---------|------|--------------------|------------------|
| `@agent-runtime/core` | Engine loop, `Tool`/`Skill`/`Agent`/`Session` (optional **`expiresAtMs`** / **`SessionExpiredError`**), registries, built-in memory tools, vector tools, `send_message`, `InProcessMessageBus`, `RunStore`, **`buildEngineDeps`** / **`createRun`** / **`executeRun`**, **`RunBuilder.onWait`**, **`effectiveToolAllowlist`**, optional **`toolTimeoutMs`**, adapters as interfaces | — | **Implemented** (Phases 1–4, 4b, 6–7; worker API + cluster docs — see `docs/plan.md` **Progress snapshot**) |
| `@agent-runtime/utils` | Parsers, chunking, file-resolver ([`16-utils.md`](./core/16-utils.md)) | — | **Implemented** (parsers: txt/md/json/csv/html; chunking: fixed_size/sentence/paragraph/recursive; file-resolver: local/http) |
| `@agent-runtime/adapters-redis` | `RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus` (`ioredis`, Redis Streams) | `core` | **Implemented** — **default** for `REDIS_URL` / cluster memory + runs + bus (no vector here) |
| `@agent-runtime/adapters-upstash` | `UpstashRedisMemoryAdapter`, `UpstashVectorAdapter`, `UpstashRunStore`, `UpstashRedisMessageBus` (HTTP) | `core` | **Implemented** — REST + vector; optional vs TCP Redis |
| `@agent-runtime/adapters-openai` | `OpenAILLMAdapter`, `OpenAIEmbeddingAdapter` (fetch) | `core` | **Implemented** |
| `@agent-runtime/adapters-bullmq` | `createEngineQueue`, `createEngineWorker`, `dispatchEngineJob`, `EngineJobPayload` (**BullMQ** — priority async / workers) | `core`, `bullmq` | **Implemented** (orchestrate delayed `resume` in app) |
| `@agent-runtime/rag` | File-based RAG tools + skills ([`17-rag-pipeline.md`](./core/17-rag-pipeline.md)) | `core`, `utils` | **Implemented** (file_read, file_ingest, file_list tools; rag, rag-reader skills) |
| `@agent-runtime/scaffold` | Programmatic `scaffold.initProject` / `generate*` ([`18-scaffold.md`](./core/18-scaffold.md) API) | `core` | **Implemented** (TS templates, manifest) |
| `@agent-runtime/cli` | `agent-runtime` binary + `runCli()` (delegates to `scaffold`) | `scaffold` | **Implemented** (argv → scaffold API) |

---

## 1. Package map

Subtrees under `packages/*/src` describe the **target** layout from `docs/core/*`. Empty or minimal barrels are expected until the corresponding §12 phase lands.

```
agent-runtime/                    → repo root (Turborepo)
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── packages/
│   ├── core/                         → @agent-runtime/core
│   │   ├── src/
│   │   │   ├── engine/               → Engine loop, state machine, run management
│   │   │   ├── context/              → Context Builder
│   │   │   ├── adapters/             → Adapter interfaces (no implementations)
│   │   │   │   ├── memory/
│   │   │   │   ├── tool/
│   │   │   │   ├── llm/
│   │   │   │   ├── embedding/
│   │   │   │   └── vector/
│   │   │   ├── tools/                → ToolRunner + built-in tool handlers
│   │   │   │   ├── builtins.ts       → save_memory, get_memory
│   │   │   │   ├── vectorTools.ts    → vector_search, vector_upsert, vector_delete
│   │   │   │   └── sendMessage.ts    → send_message (multi-agent)
│   │   │   ├── protocol/             → Step, ProtocolMessage, RunEnvelope types
│   │   │   ├── security/             → SecurityLayer + SecurityContext
│   │   │   ├── bus/                  → MessageBus interface + InProcessMessageBus
│   │   │   ├── errors/               → Error classes and codes
│   │   │   ├── config/               → RuntimeConfig type
│   │   │   ├── define/               → Tool.define, Skill.define, Agent.define, Agent.load, registry
│   │   │   └── index.ts              → Public API barrel
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── vitest.config.ts
│   │
│   ├── adapters-upstash/             → @agent-runtime/adapters-upstash
│   │   ├── src/
│   │   │   ├── UpstashRedisMemoryAdapter.ts
│   │   │   ├── UpstashVectorAdapter.ts
│   │   │   ├── UpstashRunStore.ts
│   │   │   ├── UpstashRedisMessageBus.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core (workspace:*)
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── adapters-openai/              → @agent-runtime/adapters-openai
│   │   ├── src/
│   │   │   ├── OpenAILLMAdapter.ts
│   │   │   ├── OpenAIEmbeddingAdapter.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core (workspace:*)
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── adapters-redis/               → @agent-runtime/adapters-redis (TCP Redis, ioredis)
│   │   ├── src/
│   │   │   ├── keys.ts
│   │   │   ├── RedisMemoryAdapter.ts
│   │   │   ├── RedisMessageBus.ts
│   │   │   ├── RedisRunStore.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core, ioredis
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── adapters-bullmq/              → @agent-runtime/adapters-bullmq (BullMQ — priority workers)
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── dispatch.ts           → dispatchEngineJob → Agent.run / resume
│   │   │   ├── queue.ts              → createEngineQueue
│   │   │   ├── worker.ts             → createEngineWorker
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core, bullmq
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── utils/                        → @agent-runtime/utils
│   │   ├── src/
│   │   │   ├── parsers/
│   │   │   │   ├── types.ts          → ParseResult interface
│   │   │   │   └── index.ts          → parseFile dispatcher (txt/md/csv/html/json built-in + registerParser)
│   │   │   ├── chunking/
│   │   │   │   ├── types.ts          → ChunkOptions, Chunk interfaces
│   │   │   │   └── index.ts          → chunkText (fixed_size/sentence/paragraph/recursive)
│   │   │   ├── file-resolver/
│   │   │   │   ├── types.ts          → ResolvedFile interface
│   │   │   │   └── index.ts          → resolveSource (local + http)
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── cli/                          → @agent-runtime/cli
│   │   ├── src/
│   │   │   └── index.ts              → entry (parse argv; delegate to @agent-runtime/scaffold)
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core, @agent-runtime/scaffold (workspace:*)
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │       (Phase 8 may add src/commands/*.ts — still delegates to @agent-runtime/scaffold)
│   │
│   ├── rag/                          → @agent-runtime/rag (file-based RAG tools)
│   │   ├── src/
│   │   │   ├── tools/
│   │   │   │   ├── fileRead.ts       → file_read tool (resolveSource → parseFile)
│   │   │   │   ├── fileIngest.ts     → file_ingest tool (resolve → parse → chunk → embed → upsert)
│   │   │   │   └── fileList.ts       → file_list tool (vector query for ingested docs)
│   │   │   ├── skills/
│   │   │   │   └── rag.ts            → rag + rag-reader skill definitions
│   │   │   └── index.ts              → getRagRegistrations() + exports
│   │   ├── tests/
│   │   ├── package.json              → deps: @agent-runtime/core, @agent-runtime/utils (workspace:*)
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   └── scaffold/                     → @agent-runtime/scaffold (programmatic API + templates)
│       ├── src/
│       │   ├── index.ts              → export scaffold = { initProject, generateAgent, generateTool, generateSkill }
│       │   ├── types.ts
│       │   ├── init-project.ts
│       │   ├── generate.ts
│       │   ├── fs-utils.ts
│       │   ├── strings.ts
│       │   ├── runtime-snippet.ts
│       │   └── templates/            → TypeScript template modules (not .hbs in cli)
│       │       ├── default.ts
│       │       ├── minimal.ts
│       │       └── multi-agent.ts
│       ├── tests/
│       ├── package.json              → deps: @agent-runtime/core (workspace:*)
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── vitest.config.ts
│
└── docs/                             → documentation (not a package)
```

---

## 2. Canonical types and interfaces

Every type below maps to a specific source doc. Implementations MUST match these signatures exactly.

### 2.1 Run status and Step (source: `03`, `07`)

```typescript
// packages/core/src/protocol/types.ts

// "cancelled" is not a distinct status — cancellation sets "failed" with
// RunCancelledError (code RUN_CANCELLED). See §3 error taxonomy.
type RunStatus = "running" | "waiting" | "completed" | "failed";

type Step =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; input: unknown }
  | { type: "wait"; reason: string; details?: unknown }
  | { type: "result"; content: string };

interface ProtocolMessage {
  type: "thought" | "action" | "observation" | "wait" | "result";
  content: unknown;
  meta: {
    ts: string;          // ISO-8601
    source: "llm" | "engine" | "tool";
  };
}

interface Run {
  runId: string;
  agentId: string;
  sessionId?: string;
  status: RunStatus;
  history: ProtocolMessage[];
  state: {
    iteration: number;
    pending: null | { reason: string; details?: unknown };
    [key: string]: unknown;
  };
}

interface RunEnvelope {
  id: string;
  agentId: string;
  sessionId?: string;
  messages: ProtocolMessage[];
  state: Record<string, unknown>;
  tools: string[];
  status: RunStatus;
}
```

### 2.2 Agent definition (source: `07`)

```typescript
// packages/core/src/define/types.ts

interface AgentDefinition {
  id: string;
  systemPrompt: string;
  skills?: string[];
  tools?: string[];
  memoryConfig?: Record<string, unknown>;
  llm?: { provider: string; model: string; [key: string]: unknown };
}

interface AgentDefinitionPersisted extends AgentDefinition {
  name?: string;
  projectId?: string;
  defaultMemory?: Record<string, unknown>;
  security?: { roles?: string[]; scopes?: string[] };
}
```

### 2.3 Tool definition (source: `07`)

```typescript
// packages/core/src/define/types.ts

interface ToolDefinition {
  id: string;
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scope?: "global";
  projectId?: string;
  roles?: string[];
}
```

### 2.4 Skill definition (source: `07`, `12`)

```typescript
// packages/core/src/define/types.ts

interface SkillDefinition {
  id: string;
  name?: string;
  scope?: "global";
  projectId?: string;
  tools: string[];
  description?: string;
  roles?: string[];
  execute?: SkillExecute;
}

type SkillExecute = (args: {
  input: unknown;
  context: {
    agentId: string;
    runId: string;
    memory: MemoryAdapter;
    invokeTool: (name: string, input: unknown) => Promise<unknown>;
  };
}) => Promise<unknown>;
```

### 2.5 Session and security (source: `07`, `08`, `15`)

```typescript
// packages/core/src/security/types.ts

interface SessionOptions {
  id: string;
  projectId: string;
  endUserId?: string;
  /** When set, `run` / `resume` / `onWait` continuations fail after this instant (Unix ms). */
  expiresAtMs?: number;
}

interface SecurityContext {
  principalId: string;
  kind: "user" | "service" | "end_user" | "internal";
  organizationId: string;
  projectId: string;
  endUserId?: string;
  roles: string[];
  scopes: string[];
}
```

### 2.6 Memory adapter (source: `05`)

```typescript
// packages/core/src/adapters/memory/MemoryAdapter.ts

interface MemoryAdapter {
  save(scope: MemoryScope, memoryType: string, content: unknown): Promise<void>;
  query(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<unknown[]>;
  delete(scope: MemoryScope, memoryType: string, filter?: unknown): Promise<void>;
  getState(scope: MemoryScope): Promise<unknown>;
}

interface MemoryScope {
  projectId: string;
  agentId: string;
  sessionId: string;
  endUserId?: string;
}
```

**Key patterns** (storage key construction):

```
{projectId}:{agentId}:{sessionId}:shortTerm:…
{projectId}:{agentId}:{sessionId}:working:…
{projectId}:{agentId}:eu:{endUserId}:longTerm:…
{projectId}:{agentId}:eu:{endUserId}:vectorMemory:…
```

Fallback when no `endUserId`: `longTerm` uses `{sessionId}` instead of `eu:{endUserId}`.

**Logical memory types:**

| Type | Scoped by | Purpose |
|------|-----------|---------|
| `shortTerm` | `sessionId` | Recent turns in context |
| `working` | `sessionId` | Session/run variables |
| `longTerm` | `endUserId` (or `sessionId` fallback) | Cross-session persistence |
| `vectorMemory` | `endUserId` (or `sessionId` fallback) | Semantic retrieval |

### 2.7 Tool adapter (source: `05`)

```typescript
// packages/core/src/adapters/tool/ToolAdapter.ts

interface ToolAdapter {
  name: string;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
  validate?(input: unknown): boolean;
}

interface ToolContext {
  projectId: string;
  agentId: string;
  runId: string;
  sessionId: string;
  endUserId?: string;
  memoryAdapter: MemoryAdapter;
  securityContext: SecurityContext;
}

interface ObservationContent {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### 2.8 LLM adapter (source: `10`)

```typescript
// packages/core/src/adapters/llm/LLMAdapter.ts

interface LLMRequest {
  provider: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tools?: Array<{ name: string; description?: string; parameters: object }>;
  toolChoice?: "auto" | "none" | { type: "tool"; name: string };
  responseFormat?: { type: "json_object" } | { type: "json_schema"; schema: object };
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onStreamChunk?: (text: string) => void;
}

interface LLMResponse {
  content: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | string;
  raw?: unknown;
}

interface LLMAdapter {
  generate(request: LLMRequest): Promise<LLMResponse>;
}
```

### 2.9 Embedding adapter (source: `17`)

```typescript
// packages/core/src/adapters/embedding/EmbeddingAdapter.ts

interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

### 2.10 Vector adapter (source: `17`)

```typescript
// packages/core/src/adapters/vector/VectorAdapter.ts

interface VectorAdapter {
  upsert(namespace: string, documents: VectorDocument[]): Promise<void>;
  query(namespace: string, params: VectorQuery): Promise<VectorResult[]>;
  delete(namespace: string, params: VectorDeleteParams): Promise<void>;
}

interface VectorDocument {
  id: string;
  vector: number[];
  data: string;
  metadata?: Record<string, unknown>;
}

interface VectorQuery {
  vector: number[];
  topK: number;
  filter?: Record<string, unknown>;
  includeData?: boolean;
  includeMetadata?: boolean;
  scoreThreshold?: number;
}

interface VectorResult {
  id: string;
  score: number;
  data?: string;
  metadata?: Record<string, unknown>;
}

interface VectorDeleteParams {
  ids?: string[];
  filter?: Record<string, unknown>;
  deleteAll?: boolean;
}
```

### 2.11 MessageBus (source: `09`)

```typescript
// packages/core/src/bus/MessageBus.ts

interface AgentMessage {
  id: string;
  correlationId?: string;
  fromAgentId: string;
  toAgentId: string;
  projectId: string;
  sessionId?: string;
  type: "request" | "reply" | "event";
  payload: unknown;
  meta?: { ts: string };
}

interface MessageBus {
  send(msg: Omit<AgentMessage, "id">): Promise<void>;
  waitFor(
    agentId: string,
    filter: { correlationId?: string; fromAgentId?: string },
    options?: { timeoutMs?: number },
  ): Promise<AgentMessage>;
}
```

### 2.12 Context Builder output (source: `11`)

```typescript
// packages/core/src/context/ContextBuilder.ts

interface BuiltContext {
  messages: LLMRequest["messages"];
  tools?: LLMRequest["tools"];
  toolChoice?: LLMRequest["toolChoice"];
  responseFormat?: LLMRequest["responseFormat"];
}
```

### 2.13 Utils types (source: `16`)

```typescript
// packages/utils/src/parsers/types.ts

interface ParseResult {
  text: string;
  metadata: {
    mimeType: string;
    pages?: number;
    encoding?: string;
    title?: string;
  };
}

// packages/utils/src/chunking/types.ts

interface ChunkOptions {
  method: "fixed_size" | "sentence" | "paragraph" | "recursive";
  maxTokens: number;
  overlap: number;
}

interface Chunk {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

// packages/utils/src/file-resolver/types.ts

interface ResolvedFile {
  buffer: Buffer;
  mimeType: string;
  size: number;
  name: string;
}
```

### 2.14 Runtime config (source: `18`)

```typescript
// packages/core/src/config/RuntimeConfig.ts

interface RuntimeConfig {
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
    model: string;   // e.g. "gpt-4o"
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
}
```

---

## 3. Error classes and codes (source: `13`)

```typescript
// packages/core/src/errors/index.ts

abstract class EngineError extends Error {
  abstract code: string;
}

class RunInvalidStateError extends EngineError     { code = "RUN_INVALID_STATE"; }
class StepSchemaError extends EngineError          { code = "STEP_SCHEMA_ERROR"; }
class ToolNotAllowedError extends EngineError      { code = "TOOL_NOT_ALLOWED"; }
class ToolExecutionError extends EngineError       { code = "TOOL_EXECUTION_ERROR"; }
class ToolValidationError extends EngineError      { code = "TOOL_VALIDATION_ERROR"; }
class MaxIterationsError extends EngineError       { code = "MAX_ITERATIONS_EXCEEDED"; }
class RunTimeoutError extends EngineError          { code = "RUN_TIMEOUT"; }
class LLMTransportError extends EngineError        { code = "LLM_TRANSPORT_ERROR"; }
class LLMRateLimitError extends EngineError        { code = "LLM_RATE_LIMIT"; }
class LLMClientError extends EngineError           { code = "LLM_CLIENT_ERROR"; }
class RunCancelledError extends EngineError        { code = "RUN_CANCELLED"; }
class SecurityError extends EngineError            { code = "SECURITY_DENIED"; }
```

`StepSchemaError` covers both single-parse failures and exhausted recovery attempts (the engine throws it after `maxParseRecovery` retries). No separate error class is needed — keep one code (`STEP_SCHEMA_ERROR`) for all parse-related terminal failures.

**Error handling rules:**

| Category | Retry? | Constant |
|----------|--------|----------|
| LLM transport / timeout | Yes, bounded | `LLM_TRANSPORT_ERROR` |
| LLM 429 rate limit | Yes, backoff | `LLM_RATE_LIMIT` |
| LLM 4xx client | No | `LLM_CLIENT_ERROR` |
| Step parsing | 1 re-prompt, then fail | `STEP_SCHEMA_ERROR` |
| Disallowed tool | No | `TOOL_NOT_ALLOWED` |
| Tool validation | No | `TOOL_VALIDATION_ERROR` |
| Tool exception | Optional 1 retry, then error observation | `TOOL_EXECUTION_ERROR` |
| Abort | No | `RUN_CANCELLED` |

---

## 4. Engine loop specification (source: `03`, `13`)

### 4.1 State machine

`RunStatus` tracks only persisted states. The `executeRun` function sets `status = "running"` as its first instruction, so there is no separate `"initialized"` value in the union.

```
running ⇄ waiting → running → completed
   ↘ failed
```

### 4.2 `EngineDeps` and `EngineHooks`

```typescript
// packages/core/src/engine/types.ts

interface EngineDeps {
  agent: AgentDefinition;
  session: Session;
  memoryAdapter: MemoryAdapter;
  llmAdapter: LLMAdapter;
  toolRunner: ToolRunner;
  toolRegistry: Map<string, ToolAdapter>;
  contextBuilder: { build(input: ContextBuilderInput): Promise<BuiltContext> };
  securityContext: SecurityContext;
  limits: {
    maxIterations: number;
    maxParseRecovery: number;
    runTimeoutMs: number;
  };
  signal?: AbortSignal;
  hooks?: EngineHooks;
}

interface LLMResponseMeta {
  agentId: string;
  runId: string;
}

interface EngineHooks {
  onThought?: (step: Step) => void;
  onAction?: (step: Step) => void;
  onObservation?: (observation: unknown) => void;
  onWait?: (step: Step) => void;
  onLLMResponse?: (response: LLMResponse, meta: LLMResponseMeta) => void;
}
```

Hooks are **observability only** — they must not alter loop flow or throw.

`onLLMResponse` fires after every `LLMAdapter.generate` call, before step parsing. It exposes the raw `LLMResponse` including `usage` (token counts) and `finishReason`, plus `LLMResponseMeta` with `agentId` and `runId` — enabling cost tracking, billing, and quota enforcement scoped to project and organization without touching the loop.

### 4.3 Pseudocode

```typescript
// packages/core/src/engine/Engine.ts

async function executeRun(run: Run, deps: EngineDeps): Promise<Run> {
  run.status = "running";

  while (run.state.iteration < deps.limits.maxIterations) {
    // 1. Build context
    const ctx = await deps.contextBuilder.build({
      agent: deps.agent,
      run,
      session: deps.session,
      memoryAdapter: deps.memoryAdapter,
      securityContext: deps.securityContext,
      toolRegistry: deps.toolRegistry,
    });

    // 2. Call LLM
    const llmResponse = await deps.llmAdapter.generate({
      provider: deps.agent.llm.provider,
      model: deps.agent.llm.model,
      ...ctx,
      signal: deps.signal,
    });
    deps.hooks?.onLLMResponse?.(llmResponse, {
      agentId: deps.agent.id,
      runId: run.runId,
    });

    // 3. Parse Step (with recovery)
    let step: Step;
    try {
      step = parseStep(llmResponse.content);
    } catch {
      if (run.state.parseAttempts < deps.limits.maxParseRecovery) {
        run.state.parseAttempts = (run.state.parseAttempts ?? 0) + 1;
        // inject correction message, continue loop
        continue;
      }
      run.status = "failed";
      throw new StepSchemaError();
    }

    // 4. Branch by step type
    switch (step.type) {
      case "thought":
        appendHistory(run, step, "llm");
        deps.hooks?.onThought?.(step);
        break;

      case "action":
        appendHistory(run, step, "llm");
        deps.hooks?.onAction?.(step);
        // validate tool allowlist + security
        const observation = await deps.toolRunner.execute(step.tool, step.input, {
          projectId: deps.session.projectId,
          agentId: deps.agent.id,
          runId: run.runId,
          sessionId: deps.session.id,
          endUserId: deps.session.endUserId,
          memoryAdapter: deps.memoryAdapter,
          securityContext: deps.securityContext,
        });
        appendHistory(run, { type: "observation", content: observation }, "tool");
        deps.hooks?.onObservation?.(observation);
        break;

      case "wait":
        appendHistory(run, step, "llm");
        run.status = "waiting";
        run.state.pending = { reason: step.reason, details: step.details };
        deps.hooks?.onWait?.(step);
        return run; // persist and return to caller

      case "result":
        appendHistory(run, step, "llm");
        run.status = "completed";
        return run;
    }

    run.state.iteration++;
  }

  run.status = "failed";
  throw new MaxIterationsError();
}
```

### 4.4 Parse Step logic (source: `13` §6–7)

```typescript
// packages/core/src/engine/parseStep.ts

function parseStep(raw: string): Step {
  // 1. Strip markdown fences if present
  const json = stripFences(raw);
  // 2. JSON.parse
  const obj = JSON.parse(json);
  // 3. Validate discriminant
  if (!["thought", "action", "wait", "result"].includes(obj.type)) {
    throw new StepSchemaError(`Invalid step type: ${obj.type}`);
  }
  // 4. Validate required fields per type
  switch (obj.type) {
    case "thought":
    case "result":
      if (typeof obj.content !== "string") throw new StepSchemaError("Missing content");
      break;
    case "action":
      if (typeof obj.tool !== "string") throw new StepSchemaError("Missing tool");
      break;
    case "wait":
      if (typeof obj.reason !== "string") throw new StepSchemaError("Missing reason");
      break;
  }
  return obj as Step;
}
```

### 4.5 Re-prompt on parse failure

- Max recovery attempts: `maxParseRecovery` (default `1`).
- Inject ephemeral system/user message: `"Your last output was not valid JSON. Return only one object with type and required fields."`
- Do NOT append invalid output to protocol history.
- On second failure: `failed` + `STEP_SCHEMA_ERROR`.

---

## 5. Context Builder specification (source: `11`)

### 5.1 Build order

1. Agent **system prompt** — includes JSON Step output rule.
2. **Working memory** (compact) — scoped by `sessionId`.
3. **Long-term memory** (retrieved chunks) — scoped by `endUserId` when present, else `sessionId`.
4. **Short-term memory** — last N turns, scoped by `sessionId`.
5. **Tool catalog** — filtered names + descriptions + `inputSchema`.
6. **Skills** — active skill instructions (optional).
7. **Protocol history** — mapped to `user`/`assistant` messages.

### 5.2 Memory scope resolution

| Condition | `shortTerm`/`working` key | `longTerm`/`vectorMemory` key |
|-----------|--------------------------|-------------------------------|
| `endUserId` present | `sessionId` | `endUserId` |
| No `endUserId` | `sessionId` | `sessionId` |

### 5.3 Security filtering

Before injecting tools into the prompt:

1. Intersection: `agent.tools` ∩ registry ∩ `SecurityContext.scopes`.
2. Deny sensitive tools by default if principal lacks scope.
3. Validate `projectId` on all memory reads.
4. Validate `endUserId` matches on `longTerm`/`vectorMemory` reads.

### 5.4 Truncation

- Global token budget split across system, memory, history.
- Drop least relevant long-term first.
- Fail with clear error if still over budget after truncation.

---

## 6. ToolRunner specification (source: `04`, `05`, `07`)

```typescript
// packages/core/src/tools/ToolRunner.ts

class ToolRunner {
  private registry: Map<string, ToolAdapter>;

  register(tool: ToolAdapter): void;

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.resolve(name, context); // project → global
    // 1. Check allowlist (agent.tools)
    // 2. Check SecurityContext.scopes
    // 3. Run tool.validate?.(input) — on failure: error observation
    // 4. Execute with timeout
    // 5. Return observation { success, data } or error observation
  }
}
```

### 6.1 Built-in tools (MVP)

| Tool | Handler |
|------|---------|
| `save_memory` | `memoryAdapter.save(scope, memoryType, content)` |
| `get_memory` | `memoryAdapter.query(scope, memoryType, filter)` |
| `update_state` | Bounded working memory update |

### 6.2 Vector tools (MVP+) — `packages/core/src/tools`

These only depend on adapter interfaces (`EmbeddingAdapter`, `VectorAdapter`), so they stay in `core`.

| Tool | Handler flow |
|------|-------------|
| `vector_search` | `embed(query)` → `vectorAdapter.query(ns, …)` → results |
| `vector_upsert` | `embedBatch(contents)` → `vectorAdapter.upsert(ns, docs)` → `{ stored: N }` |
| `vector_delete` | `vectorAdapter.delete(ns, params)` |

### 6.3 File / RAG tools (MVP+) — `packages/rag/src/tools`

These import from `@agent-runtime/utils` (parsers, chunking, file-resolver), so they live in the `rag` package.

| Tool | Handler flow |
|------|-------------|
| `file_read` | `resolveSource` → `parseFile` → `{ content, metadata }` |
| `file_ingest` | `resolveSource` → `parseFile` → `chunkText` → `embedBatch` → `upsert` → `{ chunksCreated }` |
| `file_list` | Query document registry from MemoryAdapter |

### 6.4 Multi-agent tool

| Tool | Handler |
|------|---------|
| `send_message` | `messageBus.send({ to, type, content, correlationId, … })` → `{ success, messageId }` |

---

## 7. Define API specification (source: `07`)

```typescript
// packages/core/src/define/Tool.ts
class Tool {
  static async define(def: ToolDefinition & { execute?: ToolAdapter["execute"] }): Promise<void>;
}

// packages/core/src/define/Skill.ts
class Skill {
  static async define(def: SkillDefinition): Promise<void>;
}

// packages/core/src/define/Agent.ts
class Agent {
  static async define(def: AgentDefinitionPersisted): Promise<void>;
  static async load(agentId: string, opts: { session: Session }): Promise<AgentInstance>;
}

// packages/core/src/define/Session.ts
class Session {
  id: string;
  projectId: string;
  endUserId?: string;
  expiresAtMs?: number;
  constructor(opts: SessionOptions);
  isExpired(atMs?: number): boolean;
}
```

### 7.1 AgentInstance (runtime)

```typescript
interface AgentInstance {
  id: string;
  run(input: string): RunBuilder;
  resume(runId: string, input: { type: string; content: string }): RunBuilder;
}

interface RunBuilder {
  onThought(cb: (step: Step) => void): RunBuilder;
  onAction(cb: (step: Step) => void): RunBuilder;
  onObservation(cb: (obs: unknown) => void): RunBuilder;
  onWait(cb: (step: Step) => Promise<string | undefined>): RunBuilder;
  onLLMResponse(cb: (response: LLMResponse, meta: LLMResponseMeta) => void): RunBuilder;
  onLLMAfterParse(
    cb: (
      response: LLMResponse,
      meta: LLMResponseMeta,
      outcome: "parsed" | "parse_failed_recoverable" | "parse_failed_fatal",
    ) => void,
  ): RunBuilder;
  then(cb: (result: unknown) => void): Promise<void>;
  catch(cb: (err: Error) => void): RunBuilder;
}
```

### 7.2 `watchUsage` — token tracking with billing context

`watchUsage` wires **`onLLMAfterParse`** (see `EngineHooks` in `packages/core`) so each LLM call is counted **after** `parseStep`. Totals include every call; **`wastedPromptTokens`**, **`wastedCompletionTokens`**, and **`wastedTotalTokens`** add the same usage rows when the outcome is **`parse_failed_recoverable`** or **`parse_failed_fatal`** (output was not valid JSON for a step). Effective spend is roughly **totals minus wasted** (or use wasted for anomaly / quality metrics). Scoped to `projectId` and `organizationId` for billing.

```typescript
// packages/core/src/engine/watchUsage.ts — shape only; see source for implementation

interface UsageSnapshot {
  projectId: string;
  organizationId: string;
  agentId: string;
  runId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wastedPromptTokens: number;
  wastedCompletionTokens: number;
  wastedTotalTokens: number;
  llmCalls: number;
}
```

The engine still exposes **`onLLMResponse`** (before parse) for streaming or logging raw model text; **`watchUsage`** uses **`onLLMAfterParse`** so waste aligns with failed parses.

**Usage:**

```typescript
const session = new Session({
  id: "queue-east-2026-04-02",
  projectId: "acme-corp",
});

const agent = await Agent.load("ops-analyst", { session });

const { builder, getUsage } = watchUsage(
  agent.run("Ticket #4412"),
  { projectId: "acme-corp", organizationId: "org-acme" },
);

await builder
  .onThought((t) => console.debug("thought", t))
  .then(async (result) => {
    const usage = getUsage();
    console.log(
      `[${usage.organizationId}/${usage.projectId}] ` +
      `agent=${usage.agentId} run=${usage.runId} — ` +
      `${usage.llmCalls} LLM calls, ${usage.totalTokens} tokens`,
    );
    // persist: await billingService.record(usage);
  });
```

This requires `onLLMResponse` to include run metadata:

```typescript
interface LLMResponseMeta {
  agentId: string;
  runId: string;
}

interface EngineHooks {
  // ...
  onLLMResponse?: (response: LLMResponse, meta: LLMResponseMeta) => void;
  onLLMAfterParse?: (
    response: LLMResponse,
    meta: LLMResponseMeta,
    outcome: "parsed" | "parse_failed_recoverable" | "parse_failed_fatal",
  ) => void;
}

interface RunBuilder {
  // ... existing methods ...
  onLLMResponse(cb: (response: LLMResponse, meta: LLMResponseMeta) => void): RunBuilder;
  onLLMAfterParse(
    cb: (
      response: LLMResponse,
      meta: LLMResponseMeta,
      outcome: "parsed" | "parse_failed_recoverable" | "parse_failed_fatal",
    ) => void,
  ): RunBuilder;
}
```

### 7.3 Resolution order

```
Tool.define  →  Skill.define  →  Agent.define  →  Agent.load + run
```

Scope resolution: **project first**, then **global**. Project definition wins on collision.

---

## 8. Skill resolution (source: `12`)

1. Load `AgentDefinition.skills` → resolve each id: project → global.
2. Union tools from all resolved skills + direct `agent.tools` → candidate set.
3. Apply `SecurityContext` filter → final tool set for Context Builder.
4. Inject skill descriptions/instructions into context if skill is "active".
5. `execute` hook: deferred past MVP (declarative + template only).

---

## 9. SecurityLayer specification (source: `08`, `15`)

### 9.1 Control points

| Operation | Minimum control |
|-----------|-----------------|
| `Agent.define` / `Tool.define` / `Skill.define` | Admin scope; `projectId` bound to org. `end_user` NEVER gets define perms. |
| `Agent.load` | Principal authorized on project; agent exists in namespace. |
| `run` / `resume` | Same project + agent; optional concurrent run quota. Validate `endUserId`. |
| Tool execution | Agent allowlist + scope for sensitive tools. |
| MessageBus | Same `projectId` only (default). |
| Memory read/write | Prefix validation: `projectId` + `agentId` + `sessionId`/`endUserId`. |

### 9.2 MVP defaults

- Local: fixed `SecurityContext` with `kind: "internal"`, `projectId: "default"`.
- Deployment: real SecurityLayer before REST exposure.

### 9.3 Principal kinds

| Kind | Who | Typical scopes |
|------|-----|----------------|
| `user` | Org member (dev, admin) | `agents:define`, `agents:run`, `tools:define`, `memory:read` |
| `service` | Org backend (API key) | `agents:run`, `agents:resume` |
| `end_user` | Org's customer | `agents:run`, `agents:resume` (exposed agents only) |
| `internal` | Engine-to-engine | Unrestricted |

---

## 10. Multi-tenancy model (source: `15`)

### 10.1 Hierarchy

```
Organization (billing, identity)      ← NOT in engine
  └── Project (hard data isolation)   ← projectId — PRIMARY namespace
       └── Session (conversation)     ← sessionId
            └── Run (execution)       ← runId
```

### 10.2 Design rules

1. `projectId` is the **only hard isolation boundary** the engine enforces.
2. Separate data needs → separate projects.
3. Teams = authorization claims → resolved to `projectIds` before engine.
4. End-users are NOT platform users. Identified by `endUserId`, authenticated by org's auth.
5. `longTerm`/`vectorMemory` keyed by `endUserId` for cross-session persistence.
6. Engine loop unchanged for any tenancy model.

---

## 11. MessageBus specification (source: `09`)

### 11.1 Coordination patterns

| Pattern | Flow |
|---------|------|
| Fire-and-forget | A sends event to B, continues to `result`. |
| Request–reply | A sends with `correlationId` → emits `wait` → B replies → A is `resume`d. |

### 11.2 Security

- Same `projectId` only by default.
- `SecurityLayer` limits which principals may trigger `agents:send`.

### 11.3 MVP

- In-process (EventEmitter + Map) or Redis-backed bus.
- `send_message` tool registered where needed.
- One documented request–reply flow + tests.

---

## 12. Implementation order (source: `06`)

Each phase builds on the previous. Interfaces from §2 are implemented progressively. Turborepo orchestrates builds and tests across all phases.

### Phase 0 — Monorepo bootstrap

| # | Task | Files |
|---|------|-------|
| 0a | Init repo, `pnpm init` | `package.json` |
| 0b | Create `pnpm-workspace.yaml` | See §0.2 |
| 0c | Create `turbo.json` | See §0.4 |
| 0d | Create `tsconfig.base.json` | See §0.5 |
| 0e | Scaffold empty `packages/core/` with `package.json`, `tsconfig.json`, `tsup.config.ts` | See §0.6 |
| 0f | Scaffold empty `packages/utils/` | Same template |
| 0g | Scaffold empty `packages/adapters-upstash/` | Same template, add `workspace:*` dep on core |
| 0h | Scaffold empty `packages/adapters-openai/` | Same template, add `workspace:*` dep on core |
| 0i | Scaffold empty `packages/cli/` | Same template, add `workspace:*` deps |
| 0j | Scaffold empty `packages/rag/` | Same template, add `workspace:*` deps on core + utils |
| 0k | Scaffold empty `packages/scaffold/` | Same template, add `workspace:*` dep on core |
| 0l | `pnpm install` | Verify workspace links |
| 0m | Verify `pnpm turbo build` runs all packages in order | — |
| 0n | Add root `eslint.config.mjs` (or `.eslintrc.cjs`), `.prettierrc`, `.gitignore` | — |

### Phase 1 — Core loop (no persistence) — `packages/core`

| # | Module | Files | Depends on |
|---|--------|-------|------------|
| 1 | Protocol types | `src/protocol/types.ts` | — |
| 2 | Error classes | `src/errors/index.ts` | — |
| 3 | LLM Adapter interface | `src/adapters/llm/LLMAdapter.ts` | Protocol types |
| 4 | Step parser | `src/engine/parseStep.ts` | Protocol types, Errors |
| 5 | Memory Adapter interface | `src/adapters/memory/MemoryAdapter.ts` | — |
| 6 | In-memory Memory Adapter | `src/adapters/memory/InMemoryMemoryAdapter.ts` | Memory interface |
| 7 | Tool Adapter interface | `src/adapters/tool/ToolAdapter.ts` | Memory interface, Security types |
| 8 | ToolRunner | `src/tools/ToolRunner.ts` | Tool interface |
| 9 | Built-in tools | `src/tools/builtins/*.ts` | Memory interface, ToolRunner |
| 10 | Define API (Tool, Skill, Agent, Session) | `src/define/*.ts` | All interfaces |
| 11 | Context Builder | `src/context/ContextBuilder.ts` | LLM types, Memory, Security |
| 12 | Engine loop | `src/engine/Engine.ts` | Everything above |
| 13 | Security types + MVP stub | `src/security/*.ts` | — |
| 14 | Barrel export | `src/index.ts` | All modules |
| 15 | `RunBuilder`, `RunStore`, `Agent.resume`, `configureRuntime({ runStore })` | `RunBuilder.ts`, `adapters/run/*` | Overlaps Phase 4b below |
| 16 | `buildEngineDeps`, `effectiveToolAllowlist`, exported registry helpers | `engine/buildEngineDeps.ts`, `define/effectiveToolAllowlist.ts` | Worker-shaped `executeRun` tests |
| 17 | `RunBuilder.onWait` | `RunBuilder.ts` | In-process wait continuation |

After Phase 1 (including rows 15–17): `pnpm turbo build --filter=@agent-runtime/core` and `pnpm turbo test --filter=@agent-runtime/core` must pass.

### Phase 2 — TCP Redis — `packages/adapters-redis`

| # | Module | Files |
|---|--------|-------|
| 15 | `RedisMemoryAdapter`, `RedisRunStore`, `RedisMessageBus` | `src/RedisMemoryAdapter.ts`, `RedisRunStore.ts`, `RedisMessageBus.ts` |
| 16 | Key pattern (`memoryKeyPrefix`) | `src/keys.ts` |
| 17 | Barrel export | `src/index.ts` |

### Phase 2a — Upstash REST + vector — `packages/adapters-upstash`

| # | Module | Files |
|---|--------|-------|
| 15a | Upstash Redis Memory Adapter | `src/UpstashRedisMemoryAdapter.ts` |
| 16a | Key pattern implementation | `src/keys.ts` |
| 17a | Barrel export | `src/index.ts` |

After Phases 2 / 2a / 5: `pnpm turbo build` builds core first (via `^build`), then `adapters-redis`, `adapters-upstash`, and `adapters-bullmq`.

### Phase 3 — LLM provider — `packages/adapters-openai`

| # | Module | Files |
|---|--------|-------|
| 18 | OpenAI LLM Adapter | `src/OpenAILLMAdapter.ts` |
| 19 | Error mapping (429, 5xx, etc.) | `src/errors.ts` |
| 20 | Barrel export | `src/index.ts` |

### Phase 4 — Hooks + hardening — `packages/core`

| # | Module | Files |
|---|--------|-------|
| 21 | Hook system (onThought, onAction, etc.) | `src/engine/hooks.ts` |
| 22 | Timeouts (global, per-iteration, per-tool) | `src/engine/Engine.ts` |
| 23 | AbortSignal propagation | `src/engine/Engine.ts`, `src/adapters/llm` |

### Phase 4b — RunStore (cluster readiness) — `packages/core` + adapter packages

| # | Module | Files / Package |
|---|--------|----------------|
| 23a | `RunStore` interface | `packages/core/src/adapters/run/RunStore.ts` |
| 23b | `InMemoryRunStore` (tests/local) | `packages/core/src/adapters/run/InMemoryRunStore.ts` |
| 23c | `Agent.resume()` using RunStore | `packages/core/src/define/Agent.ts`, `RunBuilder.ts` ✅ |
| 23d | Redis RunStore (production) | `packages/adapters-redis/src/RedisRunStore.ts` ✅ (TCP); `packages/adapters-upstash/src/UpstashRunStore.ts` ✅ (REST) |

RunStore enables `wait`/`resume` across cluster nodes — see [`19-cluster-deployment.md §3`](./core/19-cluster-deployment.md).

### Phase 5 — Job queue + cluster — `packages/adapters-bullmq` (**BullMQ priority**)

| # | Module | Notes | Status |
|---|--------|-------|--------|
| 24 | BullMQ queue + worker + `dispatchEngineJob` | `packages/adapters-bullmq/src/` (`queue.ts`, `worker.ts`, `dispatch.ts`, `types.ts`) | ✅ |
| 25 | QStash alternative | HTTP callback for serverless | Roadmap (not packaged) |
| 25a | In-process MessageBus impl | `packages/core/src/bus/InProcessMessageBus.ts` | ✅ |
| 25b | Redis Streams MessageBus | `packages/adapters-redis/src/RedisMessageBus.ts` ✅ (TCP); `packages/adapters-upstash/src/UpstashRedisMessageBus.ts` ✅ (REST) |

**BullMQ** is the primary production pattern — see [`19-cluster-deployment.md` §4](./core/19-cluster-deployment.md). **QStash** remains an optional integration you build in the host app.

### Phase 6 — RAG pipeline — `packages/utils` + `packages/core` + `packages/rag` + adapter packages ✅

| # | Module | Package | Status |
|---|--------|---------|--------|
| 26 | Utils: parsers, chunking, file-resolver | `packages/utils` | **Implemented** |
| 27 | Embedding Adapter interface + OpenAI impl | `packages/core` + `packages/adapters-openai` | **Implemented** |
| 28 | Vector Adapter interface + Upstash impl | `packages/core` + `packages/adapters-upstash` | **Implemented** |
| 29 | Vector tools (`vector_search`, `vector_upsert`, `vector_delete`) | `packages/core/src/tools/vectorTools.ts` | **Implemented** |
| 30 | File tools (`file_read`, `file_ingest`, `file_list`) | `packages/rag/src/tools/` | **Implemented** |
| 31 | RAG skills (`rag`, `rag-reader`) | `packages/rag/src/skills/rag.ts` | **Implemented** |

After Phase 6: `pnpm turbo build` builds all packages in topological order. `@agent-runtime/rag` depends on `core` + `utils`; `core` remains free of internal `workspace:*` dependencies.

### Phase 7 — Multi-agent — `packages/core` ✅

| # | Module | Files | Status |
|---|--------|-------|--------|
| 32 | MessageBus interface + InProcessMessageBus | `src/bus/MessageBus.ts`, `src/bus/InProcessMessageBus.ts` | **Implemented** |
| 33 | `send_message` tool | `src/tools/sendMessage.ts` | **Implemented** |
| 34 | Request–reply with wait/resume | `src/engine/Engine.ts` | **Implemented** (wait/resume via RunStore) |

### Phase 8 — CLI + scaffold — `packages/cli` + `packages/scaffold` ✅

| # | Module | Package | Status |
|---|--------|---------|--------|
| 35 | Programmatic scaffold API (`initProject`, `generateAgent`, `generateTool`, `generateSkill`) | `packages/scaffold` | **Implemented** |
| 36 | CLI commands (init, generate) — argv parsing, exit codes | `packages/cli` | **Implemented** |
| 37 | Project templates (TypeScript modules returning file trees) | `packages/scaffold/src/templates/` (`default`, `minimal`, `multi-agent`) | **Implemented** |

**In-repo status:** Phases **0–4**, **4b** (RunStore), **5** (**`adapters-bullmq`** — BullMQ priority), and **6–8** (RAG, multi-agent, CLI + scaffold) are implemented — `pnpm turbo run build test lint` passes for all **nine** workspace packages. **CI:** `.github/workflows/ci.yml` runs the same pipeline on push/PR. **QStash** is not a package; integrate via HTTP if needed (see [`19-cluster-deployment.md`](./core/19-cluster-deployment.md)). **Phase 9** (full integration hardening, including optional E2E with live keys) is partial. See **`docs/plan.md` → Progress snapshot**.

---

## 13. Public API surface (`@agent-runtime/core`)

```typescript
// packages/core/src/index.ts

export { Tool } from "./define/Tool";
export { Skill } from "./define/Skill";
export { Agent } from "./define/Agent";
export { Session } from "./define/Session";

export type {
  Step,
  RunStatus,
  Run,
  ProtocolMessage,
  RunEnvelope,
  AgentDefinition,
  AgentDefinitionPersisted,
  ToolDefinition,
  SkillDefinition,
  SkillExecute,
  SessionOptions,
  SecurityContext,
  MemoryAdapter,
  MemoryScope,
  ToolAdapter,
  ToolContext,
  ObservationContent,
  LLMAdapter,
  LLMRequest,
  LLMResponse,
  EmbeddingAdapter,
  VectorAdapter,
  VectorDocument,
  VectorQuery,
  VectorResult,
  VectorDeleteParams,
  MessageBus,
  AgentMessage,
  RunStore,
  BuiltContext,
  RuntimeConfig,
  EngineDeps,
  EngineHooks,
  LLMResponseMeta,
  UsageContext,
  UsageSnapshot,
} from "./types";

export { RunBuilder } from "./define/RunBuilder";
export { ContextBuilder } from "./context/ContextBuilder";
export { ToolRunner, type ToolRunnerOptions } from "./tools/ToolRunner";
export { effectiveToolAllowlist } from "./define/effectiveToolAllowlist";
export { getAgentDefinition, resolveToolRegistry } from "./define/registry";
export { watchUsage } from "./engine/watchUsage";
export { createRun, executeRun } from "./engine/Engine";
export { buildEngineDeps, securityContextForAgent } from "./engine/buildEngineDeps";

export { configureRuntime } from "./runtime/configure";
export { InMemoryMemoryAdapter } from "./adapters/memory/InMemoryMemoryAdapter";
export { InMemoryRunStore } from "./adapters/run/InMemoryRunStore";
export { InProcessMessageBus } from "./bus/InProcessMessageBus";

export {
  EngineError,
  RunInvalidStateError,
  StepSchemaError,
  ToolNotAllowedError,
  ToolExecutionError,
  ToolValidationError,
  ToolTimeoutError,
  MaxIterationsError,
  RunTimeoutError,
  LLMTransportError,
  LLMRateLimitError,
  LLMClientError,
  RunCancelledError,
  SecurityError,
} from "./errors";
```

**Cluster / worker usage (not duplicated in the export block above):**

- **`configureRuntime({ runStore })`** — persist `waiting` runs; **`Agent.resume`** loads from the store (see `docs/core/19-cluster-deployment.md`).
- **`configureRuntime({ toolTimeoutMs })`** — optional per-tool wall-clock limit (`ToolTimeoutError` / `TOOL_TIMEOUT`).
- **`RunBuilder.onWait`** — optional in-process continuation: callback returns a **string** to inject `[resume:text] …`; **`undefined`** keeps `waiting` (use **`Agent.resume`** for cross-worker).
- **`createRun` + `executeRun`** — same engine loop as **`RunBuilder`**. Prefer **`buildEngineDeps(agent, session)`** then spread into **`executeRun`** with **`startedAtMs`** (and **`resumeMessages`** after a wait). Lower-level pieces: **`ContextBuilder`**, **`ToolRunner`**, **`resolveToolRegistry`**, **`getAgentDefinition`**, **`effectiveToolAllowlist`**, **`getEngineConfig`**. See `packages/core/tests/engine.test.ts`.
- **`@agent-runtime/adapters-bullmq`** — **`createEngineQueue`**, **`createEngineWorker`**, **`dispatchEngineJob`**, **`EngineJobPayload`** (see `packages/adapters-bullmq/src/index.ts`).

---

## 14. Environment variables

```env
# LLM
OPENAI_API_KEY=

# Upstash Redis (MemoryAdapter)
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# Upstash Vector (VectorAdapter)
UPSTASH_VECTOR_URL=
UPSTASH_VECTOR_TOKEN=

# Job queue (BullMQ)
REDIS_URL=

# QStash (alternative)
QSTASH_URL=
QSTASH_TOKEN=
```

---

## 15. Testing strategy

**Runner:** Vitest (per-package `vitest.config.ts` or root `vitest.workspace.ts`). Run all via `pnpm turbo test`.

Optional root `vitest.workspace.ts` for unified IDE experience:

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*/vitest.config.ts"]);
```

| Package | Layer | What to test | Approach |
|---------|-------|-------------|----------|
| `core` | `parseStep` | Valid/invalid JSON, all step types, fence stripping | Unit, snapshot |
| `core` | Context Builder | Deterministic output from same inputs | Unit, mock memory/security |
| `core` | Engine loop | Full cycles: thought→action→result, wait→resume, max iterations, parse recovery | Integration with in-memory adapters |
| `core` | ToolRunner | Allowlist enforcement, validate, execute, error observation | Unit with mock tools |
| `core` | Security | Role intersection, scope filtering, projectId isolation | Unit |
| `core` | Define API | Tool.define→Agent.define→Agent.load→run end-to-end | Integration |
| `adapters-upstash` | Memory Adapter | Key pattern correctness, save/query/delete, endUserId scoping | Unit (mocked Redis), integration (real Upstash, CI-only) |
| `adapters-openai` | LLM Adapter | Request mapping, error classification, retry behavior | Unit with HTTP mocks |
| `utils` | Parsers | Format detection, text extraction per mime type | Unit, fixture files |
| `utils` | Chunking | All strategies, overlap, token counts | Unit, snapshot |
| `utils` | File resolver | Local path, HTTP URL resolution | Unit with mocked fs/fetch |
| `core` | Vector tools | embed→query, embed→upsert, delete | Integration with mock adapters |
| `rag` | File tools | Full pipeline: resolve→parse→chunk→embed→upsert→search | Integration with mock adapters + utils |
| `scaffold` | init + generate | Manifest paths, idempotent writes, template outputs | Unit/integration (`packages/scaffold/tests`) |
| `cli` | Commands | init, generate agent/tool/skill delegate to scaffold and exit 0 | Integration, temp dirs (Phase 8) |

---

## 16. Cross-reference to source docs

| Section | Source doc(s) |
|---------|--------------|
| Package map (monorepo blueprint) | This file §0–§1; `02-architecture`; `17-rag-pipeline` §7; `16-utils` §3 |
| User-facing scaffold / CLI | `18-scaffold` |
| Protocol types | `03-execution-model`, `04-protocol`, `07-definition-syntax` |
| Agent/Tool/Skill definitions | `07-definition-syntax` |
| Memory adapter + key patterns | `05-adapters`, `15-multi-tenancy` §4.3 |
| LLM adapter | `10-llm-adapter` |
| Embedding/Vector adapters | `17-rag-pipeline` §1 |
| Context Builder | `11-context-builder` |
| Engine loop | `03-execution-model`, `13-errors-parsing-and-recovery` |
| Error taxonomy | `13-errors-parsing-and-recovery` |
| Security | `08-scope-and-security`, `15-multi-tenancy` |
| Skills | `12-skills` |
| MessageBus | `09-communication-multiagent` |
| Cluster / RunStore / multi-process | `19-cluster-deployment` |
| RAG tools | `17-rag-pipeline` §2 |
| Utils | `16-utils` |
| MVP scope + order | `06-mvp` |
| Define API + Session | `07-definition-syntax` §9 |
| Multi-tenancy | `15-multi-tenancy` |

---

## 17. Conventions and invariants

### 17.1 Engine invariants

1. **One JSON object per LLM turn**, always with `type`. Discriminated union.
2. **LLM does not execute tools.** Side effects only through engine → ToolRunner.
3. **Append-only history.** Never mutate existing protocol messages.
4. **Durable state outside model context.** `run.state` persists; context is rebuilt each iteration.
5. **projectId is the only hard isolation boundary.** No sub-namespaces.
6. **Engine loop is unchanged** regardless of tenancy model, adapter choice, or tool set.
7. **Interfaces, not implementations.** Core depends on adapter contracts; providers swap without touching the loop.
8. **Single convention per product.** Context Builder builds prompts one way; Step parser expects that format.
9. **maxParseRecovery = 1.** One re-prompt on invalid JSON; second failure is terminal.
10. **Hooks are observability only.** `onThought`, `onAction`, `onObservation`, `onWait` do not alter loop flow.

### 17.2 Monorepo conventions

11. **pnpm workspaces only.** All inter-package references use `"workspace:*"` — never hardcoded versions.
12. **Turborepo orchestrates everything.** Never run `tsc` or `vitest` directly from root — use `pnpm turbo run <task>` (or `--filter`).
13. **`^build` dependency.** Every task that needs compiled output of another package declares `"dependsOn": ["^build"]` in `turbo.json`.
14. **tsup for builds.** Every package builds with `tsup` → `dist/` producing ESM + CJS + declarations. No manual `tsc` emit.
15. **Shared `tsconfig.base.json`.** Per-package `tsconfig.json` extends the root base — never duplicates compiler options.
16. **One barrel per package.** `src/index.ts` is the only public entry point. Internal modules are NOT re-exported unless part of the API.
17. **Tests colocated per package.** Each package has its own `tests/` directory and `vitest.config.ts`. Tests run in isolation via `pnpm turbo test --filter=@agent-runtime/PACKAGE`.
18. **No circular deps.** `core` has zero internal `workspace:*` dependencies. Adapter, util, and `rag` packages depend on `core`, never the reverse. `rag` depends on `core` + `utils`. CLI depends on scaffold + core.
19. **Cache-safe outputs.** `turbo.json` `outputs` arrays match actual build artifacts (`dist/**`). Tests and lints have empty outputs (`[]`).
20. **Clean is always available.** `pnpm turbo clean` removes all `dist/` dirs; `pnpm clean` (root) also removes `node_modules`.
