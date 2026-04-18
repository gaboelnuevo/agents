/**
 * Aligns with `docs/chat-runs-and-planner.md` — convenience **`POST /v1/chat`**:
 * binding key, first message → **`addRun`**, **`completed`** / **`failed`** → **`addContinue`** (same **`runId`**),
 * **`running`** / **`waiting`** → inline progress reply (**200**), disabled chat → **503**.
 */
import type { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import type { EngineQueue } from "@opencoreagents/adapters-bullmq";
import type { Run, RunStore } from "@opencoreagents/core";
import type Redis from "ioredis";
import type { QueueEvents } from "bullmq";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { defaultStackConfig } from "../src/config/defaults.js";
import type { ResolvedRuntimeStackConfig } from "../src/config/types.js";
import { createChatRouter } from "../src/http/chatRouter.js";
import { chatBindingRedisKey } from "../src/http/chatSessionStreamRouter.js";

const PROJECT = "doc-test-project";
const PREFIX = "def";
const CHAT_ID = "chat";

function makeRedis(): Redis {
  const data = new Map<string, string>();
  return {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
      return "OK";
    },
    del: async (k: string) => {
      data.delete(k);
      return 1;
    },
  } as unknown as Redis;
}

function stubRun(over: Partial<Run> & Pick<Run, "runId" | "status">): Run {
  return {
    agentId: CHAT_ID,
    history: [],
    state: { iteration: 0, pending: null },
    projectId: PROJECT,
    ...over,
  };
}

function mockStore(): RedisDynamicDefinitionsStore {
  return {
    methods: {
      listAgents: vi.fn().mockResolvedValue([
        {
          id: CHAT_ID,
          projectId: PROJECT,
          systemPrompt: "x",
          tools: [],
          llm: { provider: "openai", model: "gpt-4o-mini" },
        },
      ]),
    },
    Agent: { define: vi.fn().mockResolvedValue(undefined) },
  } as unknown as RedisDynamicDefinitionsStore;
}

function mockRunStore(runs: Map<string, Run>): RunStore {
  return {
    load: async (runId: string) => runs.get(runId) ?? null,
    save: vi.fn(),
    saveIfStatus: vi.fn(),
    delete: vi.fn(),
    listByAgent: vi.fn(),
  } as unknown as RunStore;
}

function mockJob(id: string) {
  return {
    id,
    waitUntilFinished: vi.fn().mockResolvedValue(null),
  };
}

function mountChatRouter(opts: {
  config: ResolvedRuntimeStackConfig;
  redis: Redis;
  runs: Map<string, Run>;
  addRun: ReturnType<typeof vi.fn>;
  addContinue: ReturnType<typeof vi.fn>;
}) {
  const app = express();
  app.use(
    "/v1",
    createChatRouter({
      store: mockStore(),
      redis: opts.redis,
      projectId: PROJECT,
      definitionsKeyPrefix: PREFIX,
      engine: { addRun: opts.addRun, addContinue: opts.addContinue } as unknown as EngineQueue,
      queueEvents: {} as QueueEvents,
      runStore: mockRunStore(opts.runs),
      jobWaitTimeoutMs: 60_000,
      config: opts.config,
      onAfterAgentCreated: vi.fn().mockResolvedValue(undefined),
    }),
  );
  return app;
}

describe("POST /v1/chat (docs/chat-runs-and-planner.md)", () => {
  it("503 when chat.defaultAgent is disabled", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const config: ResolvedRuntimeStackConfig = {
      ...defaultStackConfig,
      chat: {
        ...defaultStackConfig.chat,
        defaultAgent: { ...defaultStackConfig.chat.defaultAgent, enabled: false },
      },
    };
    const app = mountChatRouter({
      config,
      redis,
      runs,
      addRun: vi.fn(),
      addContinue: vi.fn(),
    });

    await request(app).post("/v1/chat").send({ message: "hi" }).expect(503);
  });

  it("400 when message is missing", async () => {
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis: makeRedis(),
      runs: new Map(),
      addRun: vi.fn().mockReturnValue(mockJob("j1")),
      addContinue: vi.fn(),
    });

    await request(app).post("/v1/chat").send({}).expect(400);
  });

  it("first message enqueues addRun and stores chatBinding key", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const addRun = vi.fn().mockReturnValue(mockJob("job-first"));
    const addContinue = vi.fn();
    const sessionId = "sess-doc-1";
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis,
      runs,
      addRun,
      addContinue,
    });

    const res = await request(app)
      .post("/v1/chat")
      .send({ message: "hello", sessionId })
      .expect(202);

    expect(res.body.sessionId).toBe(sessionId);
    expect(res.body.runId).toBeDefined();
    expect(res.body.agentId).toBe(CHAT_ID);
    expect(addRun).toHaveBeenCalledTimes(1);
    expect(addContinue).not.toHaveBeenCalled();
    expect(addRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        agentId: CHAT_ID,
        sessionId,
        runId: res.body.runId,
        userInput: "hello",
      }),
    );

    const bindKey = chatBindingRedisKey(PREFIX, PROJECT, sessionId);
    const raw = await redis.get(bindKey);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ runId: res.body.runId, agentId: CHAT_ID });
  });

  it("second message uses addContinue when prior run is completed (same runId)", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const addRun = vi.fn().mockReturnValue(mockJob("job-1"));
    const addContinue = vi.fn().mockReturnValue(mockJob("job-2"));
    const sessionId = "sess-doc-continue";
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis,
      runs,
      addRun,
      addContinue,
    });

    const first = await request(app)
      .post("/v1/chat")
      .send({ message: "one", sessionId })
      .expect(202);
    const { runId } = first.body;

    runs.set(runId, stubRun({ runId, status: "completed" }));

    await request(app).post("/v1/chat").send({ message: "two", sessionId }).expect(202);

    expect(addRun).toHaveBeenCalledTimes(1);
    expect(addContinue).toHaveBeenCalledTimes(1);
    expect(addContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        agentId: CHAT_ID,
        sessionId,
        runId,
        userInput: "two",
      }),
    );
  });

  it("returns inline progress reply when binding run is still running", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const addRun = vi.fn().mockReturnValue(mockJob("j1"));
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis,
      runs,
      addRun,
      addContinue: vi.fn(),
    });

    const sessionId = "sess-running";
    const first = await request(app)
      .post("/v1/chat")
      .send({ message: "start", sessionId })
      .expect(202);
    runs.set(first.body.runId, stubRun({ runId: first.body.runId, status: "running" }));

    const res = await request(app)
      .post("/v1/chat")
      .send({ message: "overlap", sessionId })
      .expect(200);

    expect(res.body.status).toBe("running");
    expect(res.body.inProgress).toBe(true);
    expect(res.body.runId).toBe(first.body.runId);
    expect(res.body.reply).toMatch(/still in progress/i);
  });

  it("returns inline progress reply when binding run is waiting", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const addRun = vi.fn().mockReturnValue(mockJob("j1"));
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis,
      runs,
      addRun,
      addContinue: vi.fn(),
    });

    const sessionId = "sess-wait";
    const first = await request(app)
      .post("/v1/chat")
      .send({ message: "wait", sessionId })
      .expect(202);
    runs.set(first.body.runId, stubRun({ runId: first.body.runId, status: "waiting" }));

    const res = await request(app)
      .post("/v1/chat")
      .send({ message: "nope", sessionId })
      .expect(200);

    expect(res.body.status).toBe("waiting");
    expect(res.body.inProgress).toBe(true);
    expect(res.body.reply).toMatch(/waiting for external input|has not finished/i);
  });

  it("after failed run, next message enqueues addContinue on the same runId", async () => {
    const redis = makeRedis();
    const runs = new Map<string, Run>();
    const addRun = vi.fn().mockReturnValueOnce(mockJob("ja"));
    const addContinue = vi.fn().mockReturnValue(mockJob("jb"));
    const app = mountChatRouter({
      config: { ...defaultStackConfig, project: { id: PROJECT } },
      redis,
      runs,
      addRun,
      addContinue,
    });

    const sessionId = "sess-fail";
    const first = await request(app)
      .post("/v1/chat")
      .send({ message: "a", sessionId })
      .expect(202);
    const runId1 = first.body.runId;
    runs.set(runId1, stubRun({ runId: runId1, status: "failed" }));

    const second = await request(app)
      .post("/v1/chat")
      .send({ message: "b", sessionId })
      .expect(202);
    expect(second.body.runId).toBe(runId1);
    expect(addRun).toHaveBeenCalledTimes(1);
    expect(addContinue).toHaveBeenCalledTimes(1);
    expect(addContinue.mock.calls[0][0]).toMatchObject({
      userInput: "b",
      runId: runId1,
    });

    const bindKey = chatBindingRedisKey(PREFIX, PROJECT, sessionId);
    const bound = JSON.parse((await redis.get(bindKey))!);
    expect(bound.runId).toBe(runId1);
  });
});
