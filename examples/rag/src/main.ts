/**
 * RAG demo: `registerRagCatalog(runtime, projectId, sources)` then run the agent.
 * Ingest pipeline implementation: `packages/rag/src/tools/fileIngestCore.ts`.
 */
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";
import { registerRagCatalog, registerRagToolsAndSkills } from "@agent-runtime/rag";

import { createDemoEmbeddingAdapter, createDemoVectorAdapter } from "./demoAdapters.js";
import {
  DEMO_FILE_READ_ROOT,
  DEMO_PRIMARY_CATALOG_ID,
  DEMO_RAG_SOURCES,
} from "./fileSources.js";
import { createScriptedRagLlm } from "./scriptedRagLlm.js";
import { printRunSummary } from "./printRun.js";

async function main(): Promise<void> {
  if (!DEMO_RAG_SOURCES.some((s) => s.id === DEMO_PRIMARY_CATALOG_ID)) {
    throw new Error(
      `DEMO_PRIMARY_CATALOG_ID "${DEMO_PRIMARY_CATALOG_ID}" missing from DEMO_RAG_SOURCES`,
    );
  }
  const embeddingAdapter = createDemoEmbeddingAdapter();
  const vectorAdapter = createDemoVectorAdapter();

  const runtime = new AgentRuntime({
    llmAdapter: createScriptedRagLlm({
      catalogIngestId: DEMO_PRIMARY_CATALOG_ID,
      searchQuery: "What does this demo say about retrieval and vector search?",
    }),
    memoryAdapter: new InMemoryMemoryAdapter(),
    embeddingAdapter,
    vectorAdapter,
    fileReadRoot: DEMO_FILE_READ_ROOT,
    maxIterations: 15,
  });

  // RAG tools first, then per-project catalog (registerRagCatalog warns if tools are missing).
  await registerRagToolsAndSkills();
  registerRagCatalog(runtime, "demo-project", DEMO_RAG_SOURCES);

  await Agent.define({
    id: "rag-demo-agent",
    projectId: "demo-project",
    systemPrompt:
      "You are a retrieval assistant. Use list_rag_sources / ingest_rag_source / vector_search as needed.",
    tools: [],
    skills: ["rag"],
    llm: { provider: "openai", model: "gpt-4o-mini" },
    security: { roles: ["agent", "admin", "operator"] },
  });

  const session = new Session({
    id: "demo-session-rag",
    projectId: "demo-project",
  });

  const agent = await Agent.load("rag-demo-agent", runtime, { session });
  const run = await agent.run("Use the knowledge base to summarize the demo document.");

  printRunSummary(run);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
