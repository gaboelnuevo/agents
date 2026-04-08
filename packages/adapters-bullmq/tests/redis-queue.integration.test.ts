import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ConnectionOptions, Worker } from "bullmq";
import type { Run } from "@agent-runtime/core";
import {
  Agent,
  configureRuntime,
  InMemoryMemoryAdapter,
  clearAllRegistriesForTests,
  __resetRuntimeConfigForTests,
} from "@agent-runtime/core";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  createEngineQueue,
  createEngineWorker,
  dispatchEngineJob,
} from "../src/index.js";

const runIntegration = process.env.REDIS_INTEGRATION === "1";

function redisConnection(): ConnectionOptions {
  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = Number(process.env.REDIS_PORT ?? 6379);
  return { host, port };
}

class QueueLLM implements LLMAdapter {
  constructor(private readonly queue: string[]) {}
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.queue[this.i++] ??
      JSON.stringify({ type: "result", content: "fallback" });
    return { content };
  }
}

describe.skipIf(!runIntegration)("BullMQ + Redis integration", () => {
  let worker: Worker | undefined;
  let queueApi: ReturnType<typeof createEngineQueue> | undefined;
  const connection = redisConnection();

  beforeEach(async () => {
    clearAllRegistriesForTests();
    __resetRuntimeConfigForTests();
  });

  afterEach(async () => {
    await worker?.close();
    await queueApi?.queue.close();
  });

  it("enqueue addRun → worker → dispatchEngineJob completes run", async () => {
    const mem = new InMemoryMemoryAdapter();
    const llm = new QueueLLM([
      JSON.stringify({ type: "thought", content: "t" }),
      JSON.stringify({ type: "result", content: "from-queue" }),
    ]);
    configureRuntime({ llmAdapter: llm, memoryAdapter: mem, maxIterations: 10 });

    await Agent.define({
      id: "int-a1",
      projectId: "p-int",
      systemPrompt: "Test.",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o" },
    });

    const queueName = `agent-engine-int-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    queueApi = createEngineQueue(queueName, connection);

    let finished: Run | undefined;
    worker = createEngineWorker(queueName, connection, async (job) => {
      finished = await dispatchEngineJob(job.data);
    });

    await new Promise((r) => setTimeout(r, 150));

    await queueApi.addRun({
      projectId: "p-int",
      agentId: "int-a1",
      sessionId: "s-int",
      userInput: "hi",
    });

    const deadline = Date.now() + 15_000;
    while (!finished && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(finished?.status).toBe("completed");
    expect(
      finished?.history.some(
        (h) => h.type === "result" && h.content === "from-queue",
      ),
    ).toBe(true);
  });
});
