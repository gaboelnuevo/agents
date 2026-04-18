import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMAdapter, LLMRequest, LLMResponse } from "@opencoreagents/core";
import {
  Agent,
  AgentRuntime,
  clearAllRegistriesForTests,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
  InProcessMessageBus,
  SessionExpiredError,
} from "@opencoreagents/core";
import {
  createRuntimeRestRouter,
  getRuntimeRestRouterProjectId,
} from "../src/runtimeRestRouter.js";

class TwoStepLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({ type: "thought", content: "t" })
        : JSON.stringify({ type: "result", content: "ok-from-rest" });
    return { content };
  }
}

/** First turn **`wait`**, second **`result`** — for inline **`resume`** tests. */
class WaitThenResultLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.i++ === 0
        ? JSON.stringify({ type: "wait", reason: "need input" })
        : JSON.stringify({ type: "result", content: "after-resume" });
    return { content };
  }
}

describe("createRuntimeRestRouter", () => {
  beforeEach(() => {
    clearAllRegistriesForTests();
  });

  it("POST /agents/:fromAgentId/send returns 501 without messageBus", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "solo",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["solo"],
        runStore,
      }),
    );

    await request(app)
      .post("/agents/solo/send")
      .send({ toAgentId: "other", payload: { x: 1 } })
      .expect(501);
  });

  it("POST /agents/:fromAgentId/send delivers via MessageBus", async () => {
    const bus = new InProcessMessageBus();
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      messageBus: bus,
      maxIterations: 10,
    });

    await Agent.define({
      id: "sender",
      projectId: "p-bus",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "receiver",
      projectId: "p-bus",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p-bus",
        agentIds: ["sender", "receiver"],
        runStore,
      }),
    );

    const incoming = bus.waitFor("receiver", { fromAgentId: "sender" });

    const res = await request(app)
      .post("/agents/sender/send")
      .send({ toAgentId: "receiver", type: "event", payload: { n: 1 } })
      .expect(200);

    expect(res.body).toMatchObject({
      projectId: "p-bus",
      fromAgentId: "sender",
      toAgentId: "receiver",
      type: "event",
      success: true,
    });

    const msg = await incoming;
    expect(msg.payload).toEqual({ n: 1 });
  });

  it("POST /agents/:fromAgentId/send rejects self-send and honors sendMessageTargetPolicy", async () => {
    const bus = new InProcessMessageBus();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      messageBus: bus,
      sendMessageTargetPolicy: () => false,
      maxIterations: 10,
    });

    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "b",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a", "b"],
      }),
    );

    await request(app).post("/agents/a/send").send({ toAgentId: "a", payload: {} }).expect(400);

    await request(app).post("/agents/a/send").send({ toAgentId: "b", payload: {} }).expect(403);
  });

  it("GET /agents/:id/memory queries MemoryAdapter when runtime is set", async () => {
    const runStore = new InMemoryRunStore();
    const memoryAdapter = new InMemoryMemoryAdapter();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter,
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "mem-agent",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    await memoryAdapter.save(
      { projectId: "p1", agentId: "mem-agent", sessionId: "s-mem" },
      "working",
      { note: "hello" },
    );

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["mem-agent"],
        runStore,
      }),
    );

    const bad = await request(app)
      .get("/agents/mem-agent/memory")
      .query({ sessionId: "s-mem" })
      .expect(400);
    expect(bad.body.error).toMatch(/memoryType/i);

    const res = await request(app)
      .get("/agents/mem-agent/memory")
      .query({ sessionId: "s-mem", memoryType: "working" })
      .expect(200);

    expect(res.body).toMatchObject({
      projectId: "p1",
      agentId: "mem-agent",
      sessionId: "s-mem",
      memoryType: "working",
    });
    expect(res.body.items).toEqual([{ note: "hello" }]);
  });

  it("GET /agents and POST /agents/:id/run", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "greeter",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(createRuntimeRestRouter({
      runtime,
      projectId: "p1",
      agentIds: ["greeter"],
      runStore,
    }));

    const agents = await request(app).get("/agents").expect(200);
    expect(agents.body.agents).toEqual([{ id: "greeter" }]);

    const run = await request(app)
      .post("/agents/greeter/run")
      .send({ message: "hi" })
      .expect(200);

    expect(run.body.status).toBe("completed");
    expect(run.body.reply).toBe("ok-from-rest");
    expect(run.body.projectId).toBe("p1");
    expect(typeof run.body.sessionId).toBe("string");
    expect(typeof run.body.runId).toBe("string");
  });

  it("returns 401 when apiKey set and header missing", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        apiKey: "secret",
      }),
    );

    await request(app).get("/agents").expect(401);
    await request(app).get("/agents").set("Authorization", "Bearer secret").expect(200);
  });

  it("resolveApiKey: same 401/200 behavior as static apiKey", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        resolveApiKey: (_req, _res) => "from-resolver",
      }),
    );

    await request(app).get("/agents").expect(401);
    await request(app).get("/agents").set("X-Api-Key", "from-resolver").expect(200);
  });

  it("resolveApiKey empty falls back to apiKey", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        apiKey: "fallback-secret",
        resolveApiKey: (_req, _res) => undefined,
      }),
    );

    await request(app).get("/agents").expect(401);
    await request(app).get("/agents").set("Authorization", "Bearer fallback-secret").expect(200);
  });

  it("without agentIds lists registry agents and accepts run for any of them", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "alpha",
      projectId: "p-open",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "beta",
      projectId: "p-open",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p-open",
        runStore,
      }),
    );

    const agents = await request(app).get("/agents").expect(200);
    expect(agents.body.agents.map((a: { id: string }) => a.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);

    await request(app)
      .post("/agents/beta/run")
      .send({ message: "hi" })
      .expect(200);

    await request(app).post("/agents/nope/run").send({ message: "x" }).expect(404);
  });

  it("agentIds allowlist intersects registry: phantom id omitted from GET /agents and 404 on run", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "real",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["real", "phantom-not-defined"],
        runStore,
      }),
    );

    const agents = await request(app).get("/agents").expect(200);
    expect(agents.body.agents).toEqual([{ id: "real" }]);

    await request(app).post("/agents/phantom-not-defined/run").send({ message: "x" }).expect(404);
  });

  it("GET /runs/:runId and inline POST resume", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new WaitThenResultLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "waiter",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["waiter"],
        runStore,
      }),
    );

    const started = await request(app)
      .post("/agents/waiter/run")
      .send({ message: "hi", sessionId: "sess-r1" })
      .expect(200);

    expect(started.body.status).toBe("waiting");
    const { runId, sessionId } = started.body;
    expect(sessionId).toBe("sess-r1");

    const snap = await request(app)
      .get(`/runs/${runId}`)
      .query({ sessionId })
      .expect(200);

    expect(snap.body.runId).toBe(runId);
    expect(snap.body.status).toBe("waiting");
    expect(snap.body.sessionId).toBe(sessionId);
    expect(snap.body.projectId).toBe("p1");
    expect(snap.body.historyStepCount).toBeGreaterThan(0);

    const hist = await request(app)
      .get(`/runs/${runId}/history`)
      .query({ sessionId })
      .expect(200);
    expect(hist.body.runId).toBe(runId);
    expect(Array.isArray(hist.body.history)).toBe(true);
    expect(hist.body.history).toHaveLength(snap.body.historyStepCount);

    const resumed = await request(app)
      .post("/agents/waiter/resume")
      .send({
        runId,
        sessionId,
        resumeInput: { type: "text", content: "go" },
      })
      .expect(200);

    expect(resumed.body.status).toBe("completed");
    expect(resumed.body.reply).toBe("after-resume");

    const snapTimeline = await request(app)
      .get(`/runs/${runId}`)
      .query({ sessionId, timeline: "1" })
      .expect(200);
    expect(Array.isArray(snapTimeline.body.history)).toBe(true);
    expect(snapTimeline.body.resumeInputs).toEqual(["go"]);
    expect(snapTimeline.body.historyStepCount).toBe(snapTimeline.body.history.length);
    const kinds = snapTimeline.body.history.map((h: { type: string }) => h.type);
    expect(kinds.some((t: string) => t === "observation")).toBe(true);

    const sess = await request(app).get("/sessions/sess-r1/status").query({ light: "1" }).expect(200);
    expect(sess.body.sessionId).toBe("sess-r1");
    expect(sess.body.projectId).toBe("p1");
    expect(sess.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(sess.body.runs.some((row: { runId: string }) => row.runId === runId)).toBe(true);
    expect(sess.body.runs[0].history).toBeUndefined();
  });

  it("GET /runs/:runId and GET /agents/:agentId/runs return 501 without runStore", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });

    await Agent.define({
      id: "greeter",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["greeter"],
      }),
    );

    await request(app).get("/runs/some-id").query({ sessionId: "s" }).expect(501);
    await request(app).get("/runs/some-id/history").query({ sessionId: "s" }).expect(501);
    await request(app).get("/agents/greeter/runs").expect(501);
    await request(app).get("/sessions/some-sid/status").expect(501);
  });

  it("GET /agents/:agentId/runs lists, filters by status and sessionId, respects limit", async () => {
    const runStore = new InMemoryRunStore();
    const meta = { ts: new Date().toISOString(), source: "llm" as const };

    await runStore.save({
      runId: "r-wait",
      agentId: "bot",
      sessionId: "sess-a",
      projectId: "p1",
      status: "waiting",
      history: [{ type: "wait", content: "w", meta }],
      state: { iteration: 0, pending: { reason: "x" }, parseAttempts: 0, userInput: "hi" },
    });
    await runStore.save({
      runId: "r-done",
      agentId: "bot",
      sessionId: "sess-b",
      projectId: "p1",
      status: "completed",
      history: [{ type: "result", content: "ok", meta }],
      state: { iteration: 1, pending: null, parseAttempts: 0, userInput: "yo" },
    });
    await runStore.save({
      runId: "r-other-agent",
      agentId: "other",
      sessionId: "sess-c",
      projectId: "p1",
      status: "completed",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0 },
    });

    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "bot",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "other",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["bot", "other"],
        runStore,
      }),
    );

    const all = await request(app).get("/agents/bot/runs").expect(200);
    expect(all.body).toMatchObject({ projectId: "p1", agentId: "bot", limit: 50 });
    expect(all.body.runs.map((r: { runId: string }) => r.runId).sort()).toEqual([
      "r-done",
      "r-wait",
    ]);

    const waitingOnly = await request(app).get("/agents/bot/runs").query({ status: "waiting" }).expect(200);
    expect(waitingOnly.body.runs).toHaveLength(1);
    expect(waitingOnly.body.runs[0].runId).toBe("r-wait");

    const sessB = await request(app)
      .get("/agents/bot/runs")
      .query({ sessionId: "sess-b" })
      .expect(200);
    expect(sessB.body.runs).toHaveLength(1);
    expect(sessB.body.runs[0].runId).toBe("r-done");

    const limited = await request(app).get("/agents/bot/runs").query({ limit: 1 }).expect(200);
    expect(limited.body.runs).toHaveLength(1);

    await request(app).get("/agents/bot/runs").query({ status: "nope" }).expect(400);
  });

  it("GET /agents/:agentId/runs omits runs when run.projectId disagrees with effective tenant", async () => {
    const runStore = new InMemoryRunStore();
    await runStore.save({
      runId: "r-a",
      agentId: "bot",
      sessionId: "s1",
      projectId: "tenant-a",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "x" },
    });

    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "bot",
      projectId: "tenant-a",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "bot",
      projectId: "tenant-b",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        allowedProjectIds: ["tenant-a", "tenant-b"],
        runStore,
      }),
    );

    const b = await request(app).get("/agents/bot/runs").set("X-Project-Id", "tenant-b").expect(200);
    expect(b.body.runs).toEqual([]);
  });

  it("inline run maps SessionExpiredError to 401 with code", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: {
        async generate() {
          throw new SessionExpiredError("session ended");
        },
      },
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "exp",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["exp"],
        runStore,
      }),
    );

    const res = await request(app).post("/agents/exp/run").send({ message: "x" }).expect(401);

    expect(res.body).toMatchObject({
      code: "SESSION_EXPIRED",
      error: "session ended",
    });
  });

  it("multi-project: X-Project-Id selects tenant", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "bot",
      projectId: "tenant-a",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "bot",
      projectId: "tenant-b",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        allowedProjectIds: ["tenant-a", "tenant-b"],
        runStore,
      }),
    );

    await request(app).get("/agents").expect(400);

    const a = await request(app).get("/agents").set("X-Project-Id", "tenant-a").expect(200);
    expect(a.body.projectId).toBe("tenant-a");
    expect(a.body.agents).toEqual([{ id: "bot" }]);

    const b = await request(app).get("/agents?projectId=tenant-b").expect(200);
    expect(b.body.projectId).toBe("tenant-b");

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "other")
      .expect(403);

    await request(app)
      .post("/agents/bot/run")
      .send({ projectId: "tenant-a", message: "hi" })
      .expect(200);
  });

  it("GET /runs returns 403 when run.projectId disagrees with effective tenant", async () => {
    const runStore = new InMemoryRunStore();
    await runStore.save({
      runId: "r-tenant",
      agentId: "bot",
      sessionId: "s-x",
      projectId: "tenant-a",
      status: "waiting",
      history: [],
      state: { iteration: 0, pending: null, parseAttempts: 0, userInput: "x" },
    });
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "bot",
      projectId: "tenant-a",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "bot",
      projectId: "tenant-b",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        allowedProjectIds: ["tenant-a", "tenant-b"],
        runStore,
      }),
    );

    await request(app)
      .get("/runs/r-tenant")
      .set("X-Project-Id", "tenant-b")
      .query({ sessionId: "s-x" })
      .expect(403);

    await request(app)
      .get("/runs/r-tenant/history")
      .set("X-Project-Id", "tenant-b")
      .query({ sessionId: "s-x" })
      .expect(403);
  });

  it("resolveApiKey can use getRuntimeRestRouterProjectId for per-project secrets", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });

    await Agent.define({
      id: "x",
      projectId: "tenant-a",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });
    await Agent.define({
      id: "x",
      projectId: "tenant-b",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        allowedProjectIds: ["tenant-a", "tenant-b"],
        runStore,
        resolveApiKey: (_req, res) => {
          const pid = getRuntimeRestRouterProjectId(res);
          if (pid === "tenant-a") return "secret-a";
          if (pid === "tenant-b") return "secret-b";
          return undefined;
        },
      }),
    );

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "tenant-a")
      .set("Authorization", "Bearer secret-b")
      .expect(401);

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "tenant-a")
      .set("Authorization", "Bearer secret-a")
      .expect(200);

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "tenant-b")
      .set("Authorization", "Bearer secret-a")
      .expect(401);

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "tenant-b")
      .set("X-Api-Key", "secret-b")
      .expect(200);
  });

  it("allowedProjectIds [\"*\"] accepts any resolved project", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });

    await Agent.define({
      id: "x",
      projectId: "dynamic-tenant-99",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        allowedProjectIds: ["*"],
      }),
    );

    const agents = await request(app)
      .get("/agents")
      .set("X-Project-Id", "dynamic-tenant-99")
      .expect(200);
    expect(agents.body.projectId).toBe("dynamic-tenant-99");
    expect(agents.body.agents).toEqual([{ id: "x" }]);

    await request(app)
      .get("/agents")
      .set("X-Project-Id", "not-defined-but-allowed")
      .expect(200);
  });

  it("throws if neither runtime nor dispatch", () => {
    expect(() => createRuntimeRestRouter({ projectId: "p" } as never)).toThrow(/runtime.*dispatch/);
  });

  it("dispatch: POST run returns 202 and GET /jobs polls", async () => {
    await Agent.define({
      id: "qagent",
      projectId: "pq",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const finishedRun = {
      runId: "run-from-worker",
      agentId: "qagent",
      status: "completed" as const,
      history: [
        {
          type: "result" as const,
          content: "queued-ok",
          meta: { ts: new Date().toISOString(), source: "llm" as const },
        },
      ],
      state: { iteration: 1, pending: null },
    };

    const addRun = vi.fn().mockResolvedValue({
      id: "job-xyz",
      waitUntilFinished: vi.fn(),
      returnvalue: undefined,
    });
    const getJob = vi.fn().mockResolvedValue({
      id: "job-xyz",
      getState: async () => "completed",
      failedReason: undefined,
      returnvalue: finishedRun,
    });
    const engine = {
      queue: { getJob },
      addRun,
      addResume: vi.fn(),
      addContinue: vi.fn(),
    };

    const app = express();
    app.use(
      "/api",
      createRuntimeRestRouter({
        dispatch: { engine: engine as never },
        projectId: "pq",
      }),
    );

    const run = await request(app)
      .post("/api/agents/qagent/run")
      .send({ message: "hi" })
      .expect(202);

    expect(run.body.jobId).toBe("job-xyz");
    expect(run.body.projectId).toBe("pq");
    expect(typeof run.body.runId).toBe("string");
    expect(run.body.runId.length).toBeGreaterThan(10);
    expect(run.body.statusUrl).toBe("/api/jobs/job-xyz");
    expect(addRun).toHaveBeenCalledWith({
      projectId: "pq",
      agentId: "qagent",
      sessionId: expect.any(String),
      runId: run.body.runId,
      userInput: "hi",
    });

    const job = await request(app).get("/api/jobs/job-xyz").expect(200);
    expect(job.body.state).toBe("completed");
    expect(job.body.run).toEqual({
      status: "completed",
      runId: "run-from-worker",
      reply: "queued-ok",
    });
  });

  it("dispatch: wait=1 without queueEvents returns 501", async () => {
    await Agent.define({
      id: "w",
      projectId: "pw",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const addRun = vi.fn().mockResolvedValue({ id: "j1", waitUntilFinished: vi.fn() });
    const engine = {
      queue: { getJob: vi.fn() },
      addRun,
      addResume: vi.fn(),
      addContinue: vi.fn(),
    };

    const app = express();
    app.use(
      createRuntimeRestRouter({
        dispatch: { engine: engine as never },
        projectId: "pw",
      }),
    );

    await request(app).post("/agents/w/run?wait=1").send({ message: "x" }).expect(501);
  });

  it("dispatch: wait=1 with queueEvents returns 200 when job completes", async () => {
    await Agent.define({
      id: "waitOk",
      projectId: "pw2",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const finishedRun = {
      runId: "run-wait",
      agentId: "waitOk",
      status: "completed" as const,
      history: [
        {
          type: "result" as const,
          content: "wait-sync-ok",
          meta: { ts: new Date().toISOString(), source: "llm" as const },
        },
      ],
      state: { iteration: 1, pending: null },
    };

    const waitUntilFinished = vi.fn().mockResolvedValue(finishedRun);
    const addRun = vi.fn().mockResolvedValue({
      id: "job-wait-ok",
      waitUntilFinished,
      returnvalue: undefined,
    });
    const engine = {
      queue: { getJob: vi.fn() },
      addRun,
      addResume: vi.fn(),
      addContinue: vi.fn(),
    };

    const app = express();
    app.use(
      createRuntimeRestRouter({
        dispatch: {
          engine: engine as never,
          queueEvents: {} as never,
        },
        projectId: "pw2",
      }),
    );

    const res = await request(app)
      .post("/agents/waitOk/run?wait=1")
      .send({ message: "hi" })
      .expect(200);

    expect(res.body.runId).toBe("run-wait");
    expect(res.body.projectId).toBe("pw2");
    expect(res.body.reply).toBe("wait-sync-ok");
    expect(waitUntilFinished).toHaveBeenCalled();
  });

  it("swagger: GET /openapi.json and /docs skip apiKey and tenant middleware", async () => {
    const runStore = new InMemoryRunStore();
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      runStore,
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        runStore,
        apiKey: "secret",
        swagger: true,
      }),
    );

    const spec = await request(app).get("/openapi.json").expect(200);
    expect(spec.body).toMatchObject({ openapi: "3.0.3" });
    expect(spec.body.paths).toHaveProperty("/agents");

    const docs = await request(app).get("/docs").expect(200);
    expect(docs.text).toContain("SwaggerUIBundle");
    expect(docs.text).toContain("openapi.json");

    await request(app).get("/agents").expect(401);
  });

  it("swagger: custom paths under mount resolve openApi file name in HTML", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      "/api",
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        swagger: { openApiPath: "spec.json", uiPath: "api-docs" },
      }),
    );

    const spec = await request(app).get("/api/spec.json").expect(200);
    expect(spec.body.openapi).toBe("3.0.3");

    const docs = await request(app).get("/api/api-docs").expect(200);
    expect(docs.text).toContain("spec.json");
    expect(docs.text).toContain("/api-docs");
  });

  it("swagger: extendOpenApi merges extra paths", async () => {
    const runtime = new AgentRuntime({
      llmAdapter: new TwoStepLlm(),
      memoryAdapter: new InMemoryMemoryAdapter(),
      maxIterations: 10,
    });
    await Agent.define({
      id: "a",
      projectId: "p1",
      systemPrompt: "x",
      tools: [],
      llm: { provider: "openai", model: "gpt-4o-mini" },
    });

    const app = express();
    app.use(
      createRuntimeRestRouter({
        runtime,
        projectId: "p1",
        agentIds: ["a"],
        swagger: {
          extendOpenApi: (spec) => ({
            ...spec,
            paths: {
              ...(spec.paths as Record<string, unknown>),
              "/v1/extra": {
                get: {
                  summary: "Host extension",
                  responses: { "200": { description: "ok" } },
                },
              },
            },
          }),
        },
      }),
    );

    const spec = await request(app).get("/openapi.json").expect(200);
    expect(spec.body.paths).toHaveProperty("/agents");
    expect(spec.body.paths).toHaveProperty("/v1/extra");
  });
});
