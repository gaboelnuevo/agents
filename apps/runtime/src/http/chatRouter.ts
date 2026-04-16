import { randomUUID } from "node:crypto";
import type { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import type { RunStore } from "@opencoreagents/core";
import type { EngineQueue } from "@opencoreagents/adapters-bullmq";
import {
  isBullmqJobWaitTimeoutError,
  summarizeEngineRun,
} from "@opencoreagents/rest-api";
import type { QueueEvents } from "bullmq";
import type Redis from "ioredis";
import express, { type Request, type Response, type Router } from "express";
import type { ResolvedRuntimeStackConfig } from "../config/types.js";
import {
  ensureDefaultChatAgentOnFirstChat,
  isChatEndpointAvailable,
} from "../runtime/runtimeChat.js";
import { resolveRunForChatReply } from "./chatRunReply.js";
import { chatBindingRedisKey } from "./chatSessionStreamRouter.js";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseWait(req: Request): boolean {
  return (
    req.query.wait === "1" ||
    req.query.wait === "true" ||
    (typeof (req.body as { wait?: unknown })?.wait === "boolean" &&
      (req.body as { wait: boolean }).wait === true)
  );
}

interface ChatBinding {
  runId: string;
  agentId: string;
}

function parseBinding(raw: string | null): ChatBinding | null {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (o == null || typeof o !== "object") return null;
    const runId = (o as ChatBinding).runId;
    const agentId = (o as ChatBinding).agentId;
    if (typeof runId !== "string" || !runId.trim()) return null;
    if (typeof agentId !== "string" || !agentId.trim()) return null;
    return { runId: runId.trim(), agentId: agentId.trim() };
  } catch {
    return null;
  }
}

export function createChatRouter(opts: {
  store: RedisDynamicDefinitionsStore;
  redis: Redis;
  projectId: string;
  definitionsKeyPrefix: string;
  engine: EngineQueue;
  queueEvents: QueueEvents;
  runStore: RunStore;
  jobWaitTimeoutMs: number;
  config: ResolvedRuntimeStackConfig;
  onAfterAgentCreated: () => Promise<void>;
}): Router {
  const r = express.Router();
  r.use(express.json({ limit: "512kb" }));

  r.post("/chat", async (req: Request, res: Response) => {
    if (!isChatEndpointAvailable(opts.config)) {
      res.status(503).json({
        error:
          "chat endpoint disabled (enable chat.defaultAgent in stack or unset RUNTIME_CHAT_DEFAULT_AGENT=off)",
      });
      return;
    }

    const body = req.body as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) {
      res.status(400).json({ error: "message (string) required" });
      return;
    }

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? body.sessionId.trim()
        : randomUUID();

    const bindKey = chatBindingRedisKey(opts.definitionsKeyPrefix, opts.projectId, sessionId);
    const chatAgentId = opts.config.chat.defaultAgent.id;

    try {
      const seed = await ensureDefaultChatAgentOnFirstChat({
        store: opts.store,
        projectId: opts.projectId,
        config: opts.config,
      });
      if (seed.created) {
        await opts.onAfterAgentCreated();
      }
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
      return;
    }

    const wait = parseWait(req);
    const message = body.message.trim();
    const projectId = opts.projectId;

    let binding = parseBinding(await opts.redis.get(bindKey));
    let jobId = "";

    try {
      if (!binding) {
        const runId = randomUUID();
        binding = { runId, agentId: chatAgentId };
        await opts.redis.set(bindKey, JSON.stringify(binding));

        const job = await opts.engine.addRun({
          projectId,
          agentId: chatAgentId,
          sessionId,
          runId,
          userInput: message,
        });
        jobId = job.id ?? "";
        if (!jobId) {
          await opts.redis.del(bindKey);
          res.status(500).json({ sessionId, error: "enqueue failed (missing job id)" });
          return;
        }

        if (!wait) {
          res.status(202).json({
            jobId,
            sessionId,
            projectId,
            runId,
            agentId: chatAgentId,
            statusUrl: `/jobs/${jobId}`,
            pollUrl: `/jobs/${jobId}`,
          });
          return;
        }

        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(opts.queueEvents, opts.jobWaitTimeoutMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res.status(504).json({ jobId, sessionId, projectId, runId, error: msg });
            return;
          }
          res.status(502).json({ jobId, sessionId, projectId, runId, error: msg });
          return;
        }

        let runDone = await resolveRunForChatReply(opts.runStore, finishedValue);
        if (!runDone) runDone = await resolveRunForChatReply(opts.runStore, job.returnvalue);
        if (runDone) {
          const s = summarizeEngineRun(runDone);
          res.json({
            jobId,
            sessionId,
            projectId,
            runId: s.runId,
            agentId: chatAgentId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }

        res.status(500).json({
          jobId,
          sessionId,
          error: "job finished but return value is missing or not a Run",
        });
        return;
      }

      const run = await opts.runStore.load(binding.runId);
      if (!run) {
        await opts.redis.del(bindKey);
        const runId = randomUUID();
        const next: ChatBinding = { runId, agentId: chatAgentId };
        await opts.redis.set(bindKey, JSON.stringify(next));

        const job = await opts.engine.addRun({
          projectId,
          agentId: chatAgentId,
          sessionId,
          runId,
          userInput: message,
        });
        jobId = job.id ?? "";
        if (!jobId) {
          await opts.redis.del(bindKey);
          res.status(500).json({ sessionId, error: "enqueue failed (missing job id)" });
          return;
        }
        if (!wait) {
          res.status(202).json({
            jobId,
            sessionId,
            projectId,
            runId,
            agentId: chatAgentId,
            statusUrl: `/jobs/${jobId}`,
            pollUrl: `/jobs/${jobId}`,
          });
          return;
        }
        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(opts.queueEvents, opts.jobWaitTimeoutMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res.status(504).json({ jobId, sessionId, projectId, runId, error: msg });
            return;
          }
          res.status(502).json({ jobId, sessionId, projectId, runId, error: msg });
          return;
        }
        let runDone = await resolveRunForChatReply(opts.runStore, finishedValue);
        if (!runDone) runDone = await resolveRunForChatReply(opts.runStore, job.returnvalue);
        if (runDone) {
          const s = summarizeEngineRun(runDone);
          res.json({
            jobId,
            sessionId,
            projectId,
            runId: s.runId,
            agentId: chatAgentId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }
        res.status(500).json({ jobId, sessionId, error: "job finished but return value is missing or not a Run" });
        return;
      }

      if (run.status === "running") {
        res.status(409).json({
          error: "run_in_progress",
          sessionId,
          projectId,
          runId: binding.runId,
          hint: "Wait for the current job or poll GET /runs/:runId",
        });
        return;
      }

      if (run.status === "waiting") {
        res.status(409).json({
          error: "run_waiting",
          sessionId,
          projectId,
          runId: binding.runId,
          hint: "Use POST /agents/:id/resume with resumeInput, or open a new chat session",
        });
        return;
      }

      if (run.status === "failed" || run.status === "completed") {
        const job = await opts.engine.addContinue({
          projectId,
          agentId: chatAgentId,
          sessionId,
          runId: binding.runId,
          userInput: message,
        });
        jobId = job.id ?? "";
        if (!jobId) {
          res.status(500).json({ sessionId, error: "enqueue failed (missing job id)" });
          return;
        }
        if (!wait) {
          res.status(202).json({
            jobId,
            sessionId,
            projectId,
            runId: binding.runId,
            agentId: chatAgentId,
            statusUrl: `/jobs/${jobId}`,
            pollUrl: `/jobs/${jobId}`,
          });
          return;
        }
        let finishedValue: unknown;
        try {
          finishedValue = await job.waitUntilFinished(opts.queueEvents, opts.jobWaitTimeoutMs);
        } catch (waitErr) {
          const msg = errorMessage(waitErr);
          if (isBullmqJobWaitTimeoutError(waitErr)) {
            res
              .status(504)
              .json({ jobId, sessionId, projectId, runId: binding.runId, error: msg });
            return;
          }
          res
            .status(502)
            .json({ jobId, sessionId, projectId, runId: binding.runId, error: msg });
          return;
        }
        let runDone = await resolveRunForChatReply(opts.runStore, finishedValue);
        if (!runDone) runDone = await resolveRunForChatReply(opts.runStore, job.returnvalue);
        if (runDone) {
          const s = summarizeEngineRun(runDone);
          res.json({
            jobId,
            sessionId,
            projectId,
            runId: s.runId,
            agentId: chatAgentId,
            status: s.status,
            ...(s.reply !== undefined ? { reply: s.reply } : {}),
          });
          return;
        }
        res.status(500).json({ jobId, sessionId, error: "job finished but return value is missing or not a Run" });
        return;
      }

      res.status(500).json({ error: `unexpected run status: ${run.status}` });
    } catch (e) {
      res.status(503).json({ sessionId, error: errorMessage(e) });
    }
  });

  return r;
}
