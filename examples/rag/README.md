# RAG example (`@agent-runtime/example-rag`)

End-to-end demo: a small **file catalog** (`id` + `description` + `source` path), then **`ingest_rag_source`** + **`vector_search`**. Default run uses a **scripted LLM** (no API keys); optional **`start:openai`** uses OpenAI.

## Register documents (app code, not the LLM)

Per-project catalog on **`AgentRuntime`** (must match **`Session.projectId`** / agent **`projectId`**):

1. **`await registerRagToolsAndSkills()`** — RAG tools + **`rag`** skill (do this first; **`registerRagCatalog`** warns if tools are missing).
2. **`registerRagCatalog(runtime, projectId, entries)`** from `@agent-runtime/rag` — replaces the catalog for that project (same as **`runtime.registerRagCatalog`**); pass **`[]`** to pin an empty catalog (no fallback to the legacy global map).

Legacy (process-wide): **`registerRagFileCatalog(entries)`** from `@agent-runtime/rag` — only used if you do **not** register a per-project catalog for that session’s project.

Each catalog entry:

| Field | Meaning |
|-------|---------|
| `id` | Stable handle the model passes to **`ingest_rag_source`** (e.g. `demo-handbook`). |
| `description` | Shown in **`list_rag_sources`** so the model knows what each id is. |
| `source` | Server-side path or URL (same rules as **`file_ingest`**: relative to effective **`fileReadRoot`** on **`Session`** or default on **`AgentRuntime`**, or http(s) when allowed). |

Edit **[`src/fileSources.ts`](./src/fileSources.ts)** — array **`DEMO_RAG_SOURCES`** and **`DEMO_FILE_READ_ROOT`**.

**`file_ingest`** remains for advanced use (arbitrary `source` string).

## File sandbox

**`fileReadRoot`** on **`AgentRuntime`** (or **`Session.fileReadRoot`**, which overrides) must point at the directory that contains catalog-relative paths (here: **`examples/rag/data/`**). HTTP and `allowFileReadOutsideRoot`: see [`packages/rag/src/tools/resolveFileSource.ts`](../../packages/rag/src/tools/resolveFileSource.ts).

## Source layout

| File | Role |
|------|------|
| [`src/fileSources.ts`](./src/fileSources.ts) | **`DEMO_RAG_SOURCES`**; **`DEMO_FILE_READ_ROOT`**. |
| [`src/main.ts`](./src/main.ts) | **`AgentRuntime`**, `registerRagToolsAndSkills`, `registerRagCatalog`, `Agent.define` / `run`. |
| [`src/demoAdapters.ts`](./src/demoAdapters.ts) | In-memory vector + demo embeddings. |
| [`src/scriptedRagLlm.ts`](./src/scriptedRagLlm.ts) | Fake LLM: `ingest_rag_source` → `vector_search` → `result`. |
| [`src/printRun.ts`](./src/printRun.ts) | Prints `run.history`. |
| [`src/openaiMain.ts`](./src/openaiMain.ts) | OpenAI chat + embeddings (`pnpm run start:openai`). |

## Ingest pipeline (library)

Shared implementation: **[`packages/rag/src/tools/fileIngestCore.ts`](../../packages/rag/src/tools/fileIngestCore.ts)** (`runFileIngestPipeline`) — used by **`file_ingest`** and **`ingest_rag_source`**.

## What to run

From the repo root:

```bash
pnpm install
pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/rag
pnpm --filter @agent-runtime/example-rag start
```

Or from this directory:

```bash
pnpm start
```

## What it shows

1. **`new AgentRuntime({ llmAdapter, memoryAdapter, embeddingAdapter, vectorAdapter, … })`**.
2. **`registerRagToolsAndSkills()`** then **`registerRagCatalog(runtime, projectId, DEMO_RAG_SOURCES)`**.
3. **`Agent.define`** with **`skills: ["rag"]`**.
4. **`AgentRuntime.fileReadRoot`** (demo) — local sandbox for catalog `source` paths; optional per-session override on **`Session`**.
5. **`security.roles`** including `admin` / `operator` for ingest tools.

## With OpenAI (optional, paid API)

**`pnpm run start:openai`** → [`src/openaiMain.ts`](./src/openaiMain.ts). Same bootstrap; the model uses **`list_rag_sources`** / **`ingest_rag_source`** with **ids**, not raw filenames.

| Piece | What OpenAI replaces |
|-------|----------------------|
| `createScriptedRagLlm` | **`OpenAILLMAdapter`** (the engine normalizes `tool_calls` when `content` is empty). |
| `createDemoEmbeddingAdapter` | **`OpenAIEmbeddingAdapter`**. |
| `createDemoVectorAdapter` | Still in-memory in this demo; swap for production vector store. |

```bash
pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/rag --filter=@agent-runtime/adapters-openai
export OPENAI_API_KEY=sk-...
pnpm --filter @agent-runtime/example-rag run start:openai
```

## Production-shaped wiring

- Prefer **`registerRagCatalog(runtime, tenantProjectId, entries)`** (or load the same shape from config/DB) per **`AgentRuntime`** / worker — independent of **`llmAdapter`**.
- Swap **`llmAdapter`** / embedding / vector adapters as needed; see [docs/core/05-adapters.md](../../docs/core/05-adapters.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm start` | `tsx src/main.ts` (no API keys) |
| `pnpm run start:openai` | `tsx src/openaiMain.ts` (**`OPENAI_API_KEY`**) |
| `pnpm typecheck` | `tsc --noEmit` |
