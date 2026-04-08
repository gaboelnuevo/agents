# RAG pipeline

How the engine supports **Retrieval-Augmented Generation**: dedicated adapters, tools, utils, and the agent patterns that connect them. RAG is not a special module — it is an agent that uses vector search tools inside the standard `thought → action → observation → result` loop.

Related: [05-adapters.md](./05-adapters.md) (MemoryAdapter, ToolAdapter), [11-context-builder.md](./11-context-builder.md) (prompt assembly), [16-utils.md](./16-utils.md) (parsers, chunking, file-resolver).

---

## 1. New adapters

RAG introduces two adapter contracts that complement the existing `MemoryAdapter` and `LLMAdapter`.

### 1.1 `EmbeddingAdapter`

Generates vector embeddings from text. Decoupled from `LLMAdapter` because embedding models differ from chat/completion models in API, pricing, and batching behavior.

```typescript
interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

| Field | Notes |
|-------|-------|
| `embed` | Single text → single vector. |
| `embedBatch` | Multiple texts in one call; implementations should respect provider batch limits internally. |
| `dimensions` | Vector size (e.g. 1536 for `text-embedding-3-small`, 3072 for `text-embedding-3-large`). Must match the vector index. |

Reference implementations:

| Provider | Model | Dimensions |
|----------|-------|------------|
| OpenAI | `text-embedding-3-small` | 1536 |
| OpenAI | `text-embedding-3-large` | 3072 |
| Cohere | `embed-english-v3.0` | 1024 |

The engine never imports a specific provider. Swap adapters in the factory; tools call `embeddingAdapter.embed(...)` without knowing the backend.

### 1.2 `VectorAdapter`

Abstracts vector storage operations. Separated from `MemoryAdapter` because vector stores have distinct semantics (similarity search, metadata filtering, namespace isolation) that do not map cleanly to `save` / `query` / `delete` on key-value memory types.

```typescript
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

**Namespace convention**: tools build the namespace from scope identifiers:

```text
{projectId}:{agentId}                → project-wide knowledge base
{projectId}:{agentId}:eu:{endUserId} → per-end-user embeddings
```

This aligns with the `vectorMemory` key patterns in [05-adapters.md](./05-adapters.md).

**Reference implementation**: Upstash Vector — serverless, HTTP-based, supports metadata filtering. Same operational model as Upstash Redis for `MemoryAdapter`.

```typescript
import { UpstashVectorAdapter } from "@agent-runtime/adapters-upstash";

const vectorAdapter = new UpstashVectorAdapter({
  url: process.env.UPSTASH_VECTOR_URL,
  token: process.env.UPSTASH_VECTOR_TOKEN,
});
```

---

## 2. RAG tools

Tools are what the LLM can invoke via `action`. Each tool orchestrates **utils** (parsing, chunking) and **adapters** (embedding, vector) internally.

### 2.1 `vector_search`

Semantic search over the knowledge base.

```typescript
await Tool.define({
  id: "vector_search",
  scope: "global",
  description:
    "Searches the knowledge base for semantically relevant fragments. " +
    "Returns top-K results ranked by similarity score.",
  inputSchema: {
    type: "object",
    properties: {
      query:          { type: "string", description: "Search text" },
      topK:           { type: "number", default: 5 },
      scoreThreshold: { type: "number", description: "Minimum similarity score (0–1)" },
      filter:         { type: "object", description: "Metadata filters (source, category, etc.)" },
    },
    required: ["query"],
  },
});
```

**Handler flow**:

1. `embeddingAdapter.embed(query)` → query vector.
2. `vectorAdapter.query(namespace, { vector, topK, filter, scoreThreshold })` → results.
3. Return results as observation.

The namespace is built from `ToolContext.projectId` + `ToolContext.agentId` (and optionally `endUserId` for per-user knowledge).

### 2.2 `vector_upsert`

Store new fragments with embeddings.

```typescript
await Tool.define({
  id: "vector_upsert",
  scope: "global",
  description:
    "Stores one or more text fragments with their embeddings in the knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:       { type: "string", description: "Fragment ID (auto-generated if omitted)" },
            content:  { type: "string" },
            metadata: { type: "object" },
          },
          required: ["content"],
        },
      },
    },
    required: ["documents"],
  },
});
```

**Handler flow**:

1. `embeddingAdapter.embedBatch(contents)` → vectors.
2. `vectorAdapter.upsert(namespace, documents)` → stored.
3. Return `{ stored: N }`.

### 2.3 `vector_delete`

Remove fragments by ID or metadata filter.

```typescript
await Tool.define({
  id: "vector_delete",
  scope: "global",
  description: "Deletes fragments from the knowledge base by ID or metadata filter.",
  inputSchema: {
    type: "object",
    properties: {
      ids:    { type: "array", items: { type: "string" } },
      filter: { type: "object", description: "Delete all matching this metadata filter" },
    },
  },
  roles: ["admin", "operator"],
});
```

### 2.4 `file_read`

Read and extract text from a file.

```typescript
await Tool.define({
  id: "file_read",
  scope: "global",
  description:
    "Reads a file and returns its extracted text content. " +
    "Supports: txt, md, json, csv, pdf, docx, html.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "File path, URL, or storage reference" },
    },
    required: ["source"],
  },
  roles: ["admin", "operator"],
});
```

**Handler flow**:

1. `resolveSource(source)` → buffer + mimeType. *(util)*
2. `parseFile(buffer, mimeType)` → text + metadata. *(util)*
3. Return `{ content, metadata }`.

No embeddings, no vector store — this tool only reads. Useful when the agent needs to inspect a file before deciding whether to ingest it.

### 2.5 `file_ingest`

Full pipeline: read → parse → chunk → embed → store.

```typescript
await Tool.define({
  id: "file_ingest",
  scope: "global",
  description:
    "Ingests a file into the vector knowledge base. " +
    "Reads the file, splits it into chunks, generates embeddings, and stores them.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "File path, URL, or storage reference" },
      chunkStrategy: {
        type: "object",
        properties: {
          method:    { enum: ["fixed_size", "sentence", "paragraph", "recursive"] },
          maxTokens: { type: "number", default: 512 },
          overlap:   { type: "number", default: 50 },
        },
      },
      metadata: { type: "object", description: "Extra metadata applied to all chunks" },
    },
    required: ["source"],
  },
  roles: ["admin", "operator"],
});
```

**Handler flow**:

1. `resolveSource(source)` → buffer + mimeType. *(util)*
2. `parseFile(buffer, mimeType)` → text + file metadata. *(util)*
3. `chunkText(text, chunkStrategy)` → chunks[]. *(util)*
4. `embeddingAdapter.embedBatch(chunks.map(c => c.content))` → vectors[]. *(adapter)*
5. `vectorAdapter.upsert(namespace, documents)` → stored. *(adapter)*
6. Return `{ chunksCreated, documentId, status: "completed" }`.

### 2.6 `file_list`

List ingested documents.

```typescript
await Tool.define({
  id: "file_list",
  scope: "global",
  description: "Lists documents that have been ingested into the knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "object" },
      limit:  { type: "number", default: 20 },
      offset: { type: "number", default: 0 },
    },
  },
});
```

Requires a **document registry** (metadata stored in `MemoryAdapter` under `longTerm` or a dedicated `documents` memory type) to track ingested files separately from their vector chunks.

---

## 3. RAG skill

Groups RAG tools and provides context instructions to the agent.

```typescript
await Skill.define({
  id: "rag",
  scope: "global",
  tools: ["vector_search", "vector_upsert", "vector_delete",
          "file_read", "file_ingest", "file_list"],
  description:
    "Retrieval-Augmented Generation: search the knowledge base before answering, " +
    "ingest new documents, and manage stored fragments.",
});
```

Agents that only need **read** access to the knowledge base can reference a subset:

```typescript
await Skill.define({
  id: "rag-reader",
  scope: "global",
  tools: ["vector_search"],
  description:
    "Search the knowledge base for relevant context before answering questions.",
});
```

---

## 4. Agent patterns

### 4.1 Knowledge-base Q&A agent

Answers questions using retrieved context. Does not ingest files.

```typescript
await Agent.define({
  id: "kb-assistant",
  projectId: "acme-corp",
  systemPrompt:
    "You answer questions using the company knowledge base. " +
    "ALWAYS use vector_search before answering factual questions. " +
    "If no relevant results are found, say so clearly. " +
    "Each turn respond with a single JSON Step object.",
  skills: ["rag-reader"],
  tools: ["vector_search", "get_memory", "save_memory"],
  memoryConfig: {
    shortTerm: { maxTurns: 15 },
    longTerm: true,
    working: {},
  },
  llm: { provider: "openai", model: "gpt-4o", temperature: 0.1 },
});
```

**Typical loop**:

```
User: "What is the return policy for international orders?"

thought  → "I need to search the knowledge base for return policy information."
action   → vector_search({ query: "return policy international orders", topK: 5 })
observation → [{ content: "International returns: 30-day window...", score: 0.94 }, ...]
thought  → "Found relevant policy. Synthesizing answer."
result   → "According to the company policy, international orders can be returned within 30 days..."
```

### 4.2 Knowledge manager agent

Can both query and ingest documents. Typically used by operators, not end-users.

```typescript
await Agent.define({
  id: "kb-manager",
  projectId: "acme-corp",
  systemPrompt:
    "You manage the company knowledge base. You can search, ingest new documents, " +
    "and remove outdated content. Each turn respond with a single JSON Step object.",
  skills: ["rag"],
  tools: ["vector_search", "vector_upsert", "vector_delete",
          "file_read", "file_ingest", "file_list",
          "save_memory", "get_memory"],
  memoryConfig: {
    shortTerm: { maxTurns: 10 },
    longTerm: true,
    working: {},
  },
  llm: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
  security: { roles: ["admin", "operator"] },
});
```

### 4.3 End-user support agent with personalized RAG

Combines project-wide knowledge with per-end-user memory.

```typescript
await Agent.define({
  id: "support-rag",
  projectId: "acme-support",
  systemPrompt:
    "You are a support agent. Use vector_search to find relevant help articles. " +
    "You also have access to this customer's history via long-term memory. " +
    "Each turn respond with a single JSON Step object.",
  skills: ["rag-reader"],
  tools: ["vector_search", "get_memory", "save_memory"],
  memoryConfig: {
    shortTerm: { maxTurns: 20 },
    longTerm: true,
    working: {},
    vectorMemory: true,
  },
  security: { roles: ["service", "end_user"] },
});
```

At runtime with `endUserId`:

```typescript
const session = new Session({
  id: "customer-789:conv-001",
  projectId: "acme-support",
  endUserId: "customer-789",
});

const agent = await Agent.load("support-rag", { session });
await agent.run("My order #8812 hasn't arrived");
```

The agent searches the **project-wide** knowledge base (help articles, policies) and reads the **end-user's** long-term memory (past interactions, preferences) — both scoped correctly by the namespace conventions in [05-adapters.md](./05-adapters.md).

### 4.4 Multi-agent RAG

A router agent delegates to specialized agents, each with its own knowledge base.

```
Agent: router
  ├── send_message → Agent: legal-kb    (vector_search on legal docs)
  ├── send_message → Agent: technical-kb (vector_search on technical docs)
  └── result: combined answer
```

Each agent has its own `projectId` or namespace, so vector stores are isolated. Coordination uses the standard `send_message` / `wait` / `resume` pattern from [09-communication-multiagent.md](./09-communication-multiagent.md).

---

## 5. Ingest pipeline (batch)

Not all ingestion happens through the agent loop. Batch ingestion can run outside the engine as a script or worker that calls the same utils and adapters:

```typescript
import { resolveSource, parseFile, chunkText } from "@agent-runtime/utils";
import { embeddingAdapter, vectorAdapter } from "./adapters";

async function ingestDirectory(dir: string, projectId: string, agentId: string) {
  const files = await listFiles(dir);
  const namespace = `${projectId}:${agentId}`;

  for (const filePath of files) {
    const file = await resolveSource(filePath);
    const { text, metadata } = await parseFile(file.buffer, file.mimeType);
    const chunks = chunkText(text, { method: "recursive", maxTokens: 512, overlap: 50 });
    const vectors = await embeddingAdapter.embedBatch(chunks.map(c => c.content));

    await vectorAdapter.upsert(
      namespace,
      chunks.map((c, i) => ({
        id: `${filePath}:${c.index}`,
        vector: vectors[i],
        data: c.content,
        metadata: { ...metadata, source: filePath, chunkIndex: c.index },
      })),
    );
  }
}
```

This reuses the exact same utils and adapters as the `file_ingest` tool — the only difference is no LLM loop involved. The engine loop is for agents; batch scripts are for operators.

---

## 6. Context Builder integration

The Context Builder already supports RAG through its recommended prompt order ([11-context-builder.md](./11-context-builder.md) §2):

> 3. **Long-term** (retrieved chunks): RAG or persisted facts; **bounded** in size.

When the agent calls `vector_search`, the retrieved chunks appear as an `observation` in the protocol history. The Context Builder includes them in subsequent LLM calls as part of the conversation flow. No special handling is needed — RAG results flow through the same `action → observation` pattern as any other tool.

For **automatic retrieval** (pre-loop, without the LLM deciding), a future imperative skill could inject vector search results into the context before the first LLM call. This is explicitly deferred past MVP ([12-skills.md](./12-skills.md) §7).

---

## 7. Source tree (RAG additions)

```
src/
  adapters/
    embedding/
      EmbeddingAdapter.ts       → interface
      OpenAIEmbeddingAdapter.ts → reference implementation
    vector/
      VectorAdapter.ts          → interface
      UpstashVectorAdapter.ts   → reference implementation
  tools/
    vector_search.ts
    vector_upsert.ts
    vector_delete.ts
    file_read.ts
    file_ingest.ts
    file_list.ts
  utils/                        → see 16-utils.md
    parsers/
    chunking/
    file-resolver/
```

---

## 8. MVP scope

| Component | MVP | MVP+ | v2 |
|-----------|-----|------|----|
| `EmbeddingAdapter` (OpenAI) | **yes** | | |
| `VectorAdapter` (Upstash Vector) | **yes** | | |
| `vector_search` tool | **yes** | | |
| `vector_upsert` tool | **yes** | | |
| `vector_delete` tool | | **yes** | |
| `file_read` tool | | **yes** | |
| `file_ingest` tool | | **yes** | |
| `file_list` tool | | **yes** | |
| Batch ingest script | | **yes** | |
| `parsers/` (txt, md, json) | **yes** | | |
| `parsers/` (pdf, docx, csv, html) | | **yes** | |
| `chunking/` (recursive) | **yes** | | |
| `chunking/` (sentence, paragraph, semantic) | | | **yes** |
| Automatic pre-loop retrieval (imperative skill) | | | **yes** |
| Multi-agent RAG routing | | | **yes** |
