/**
 * ## 1) Register documents (no LLM involved)
 *
 * Call **`registerRagCatalog(runtime, projectId, DEMO_RAG_SOURCES)`** and set **`fileReadRoot`** on **`AgentRuntime`** (see `main.ts`). Legacy: **`registerRagFileCatalog`**.
 * Each entry is `{ id, description, source }` where `source` is resolved like `file_ingest` (path relative
 * to the effective `fileReadRoot` (`Session` or `AgentRuntime`), or an allowed URL). Tools **`list_rag_sources`** and **`ingest_rag_source`**
 * use this catalog; the model only sees **id** + **description** from the list tool.
 *
 * ## 2) Session sandbox (where local paths resolve)
 *
 * | Configure | API |
 * |-----------|-----|
 * | Local root | `new AgentRuntime({ fileReadRoot: DEMO_FILE_READ_ROOT, … })` (or per-session via `Session`) |
 * | HTTP(S) `source` | `Session.allowHttpFileSources`, optional `httpFileSourceHostsAllowlist` |
 * | Unrestricted local | `Session.allowFileReadOutsideRoot` (use carefully) |
 *
 * Resolution: `packages/rag/src/tools/resolveFileSource.ts`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RagSourceDefinition } from "@agent-runtime/rag";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to `examples/rag/data/` — pass as `Session.fileReadRoot`. */
export const DEMO_FILE_READ_ROOT = path.join(here, "..", "data");

/** Editable list: add rows to expose more files under `data/` by stable id + description. */
export const DEMO_RAG_SOURCES: RagSourceDefinition[] = [
  {
    id: "demo-handbook",
    description:
      "Intro markdown for this example: RAG, catalog ingest, vector_search, and production adapters.",
    source: "sample.md",
  },
];

/** Id used by the scripted demo; must exist in {@link DEMO_RAG_SOURCES}. */
export const DEMO_PRIMARY_CATALOG_ID = "demo-handbook";
