/**
 * Same RAG wiring as `main.ts`, but **OpenAI** for chat + embeddings (paid API).
 * Catalog: `registerRagCatalog(runtime, projectId, sources)`; the model uses **ids**, not raw paths.
 * Native OpenAI `tool_calls` are handled inside `executeRun` (`normalizeLlmStepContent` in core).
 */
import { OpenAILLMAdapter, OpenAIEmbeddingAdapter } from "@agent-runtime/adapters-openai";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
} from "@agent-runtime/core";
import { registerRagCatalog, registerRagToolsAndSkills } from "@agent-runtime/rag";

import { createDemoVectorAdapter } from "./demoAdapters.js";
import { DEMO_FILE_READ_ROOT, DEMO_RAG_SOURCES } from "./fileSources.js";
import { printRunSummary } from "./printRun.js";

const PROJECT_ID = "demo-rag-openai";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY. See examples/rag/.env.example");
    process.exit(1);
  }

  const chatModel = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const embedModel = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

  const runtime = new AgentRuntime({
    llmAdapter: new OpenAILLMAdapter(apiKey),
    memoryAdapter: new InMemoryMemoryAdapter(),
    embeddingAdapter: new OpenAIEmbeddingAdapter(apiKey, embedModel),
    vectorAdapter: createDemoVectorAdapter(),
    fileReadRoot: DEMO_FILE_READ_ROOT,
    maxIterations: 25,
  });

  // RAG tools first, then per-project catalog (registerRagCatalog warns if tools are missing).
  await registerRagToolsAndSkills();
  registerRagCatalog(runtime, PROJECT_ID, DEMO_RAG_SOURCES);

  await Agent.define({
    id: "rag-openai-agent",
    projectId: PROJECT_ID,
    systemPrompt:
      "You are a retrieval assistant. Use list_rag_sources / ingest_rag_source (catalog ids only; paths are server-defined) / vector_search as needed.",
    tools: [],
    skills: ["rag"],
    llm: { provider: "openai", model: chatModel },
    security: { roles: ["agent", "admin", "operator"] },
  });

  const session = new Session({
    id: "session-rag-openai",
    projectId: PROJECT_ID,
  });

  const agent = await Agent.load("rag-openai-agent", runtime, { session });
  const run = await agent.run(
    "Ingest the demo markdown if needed, then summarize what it says about RAG and vector search.",
  );

  printRunSummary(run);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
