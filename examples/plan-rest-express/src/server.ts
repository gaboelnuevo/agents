/**
 * After `Agent.define`, mount **`createRuntimeRestRouter`** — routes match **`docs/plan-rest.md`** (fixed **`projectId`**; no **`messageBus`** here so **`POST …/send`** returns **501**).
 */
import express from "express";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@opencoreagents/core";
import {
  Agent,
  AgentRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
} from "@opencoreagents/core";
import { createRuntimeRestRouter } from "@opencoreagents/rest-api";

class DeterministicDemoLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({ type: "thought", content: "Plan greeting." })
        : JSON.stringify({
            type: "result",
            content: "Hello from plan-rest-express + @opencoreagents/rest-api.",
          });
    return { content };
  }
}

const PROJECT_ID = "plan-rest-demo";
const PORT = Number(process.env.PORT) || 3050;

const runStore = new InMemoryRunStore();
const runtime = new AgentRuntime({
  llmAdapter: new DeterministicDemoLlm(),
  memoryAdapter: new InMemoryMemoryAdapter(),
  runStore,
  maxIterations: 10,
});

await Agent.define({
  id: "demo-greeter",
  projectId: PROJECT_ID,
  systemPrompt: "You are a helpful assistant.",
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
});

const app = express();
app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "plan-rest-express" });
});

app.use(
  createRuntimeRestRouter({
    runtime,
    projectId: PROJECT_ID,
    runStore,
    resolveApiKey: () => process.env.REST_API_KEY?.trim() || undefined,
    swagger: {
      info: {
        title: "plan-rest-express",
        version: "0.0.0",
        description: "OpenAPI for routes on this demo (see docs/plan-rest.md).",
      },
    },
  }),
);

app.listen(PORT, () => {
  console.log(`http://127.0.0.1:${PORT}  GET /agents  POST /agents/demo-greeter/run`);
  console.log(
    `  GET /runs/:runId?sessionId=…  GET /runs/:runId/history?sessionId=…  GET /agents/demo-greeter/runs`,
  );
  console.log(
    "  POST /agents/<from>/send  (needs AgentRuntime({ messageBus }) — not enabled in this demo)",
  );
  console.log(
    `  GET /agents/demo-greeter/memory?sessionId=<id>&memoryType=working  (MemoryAdapter.query)`,
  );
  console.log(`  GET /openapi.json  GET /docs  (Swagger — no API key required)`);
  console.log(
    process.env.REST_API_KEY
      ? "REST_API_KEY set — send Authorization: Bearer … or X-Api-Key on API routes (not /docs or /openapi.json)"
      : "REST_API_KEY unset — /agents open",
  );
});
