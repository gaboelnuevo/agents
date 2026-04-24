import type Redis from "ioredis";
import express, { type Request, type Response, type Router } from "express";
import { chatNotifyRedisChannel } from "../redis/runEventRedis.js";

export function chatBindingRedisKey(
  definitionsKeyPrefix: string,
  projectId: string,
  sessionId: string,
  tenantId?: string,
): string {
  const p = definitionsKeyPrefix.replace(/:+$/, "").trim() || "def";
  const t = typeof tenantId === "string" && tenantId.trim().length > 0 ? tenantId.trim() : "";
  return t ? `${p}:chatBinding:${projectId}:${t}:${sessionId}` : `${p}:chatBinding:${projectId}:${sessionId}`;
}

/**
 * SSE: notifications for a **chat** `sessionId` after **`invoke_planner`** (worker publishes when the planner job ends).
 * Requires an existing binding from **`POST /v1/chat`** and **`runEvents.redis`** enabled.
 */
export function createChatSessionStreamRouter(opts: {
  redis: Redis;
  projectId: string;
  definitionsKeyPrefix: string;
}): Router {
  const r = express.Router();

  r.get("/chat/stream", async (req: Request, res: Response) => {
    const sessionId =
      typeof req.query.sessionId === "string" && req.query.sessionId.trim().length > 0
        ? req.query.sessionId.trim()
        : "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId (query) required" });
      return;
    }

    const tenantId = req.header("x-tenant-id") ?? undefined;
    const bindKey = chatBindingRedisKey(
      opts.definitionsKeyPrefix,
      opts.projectId,
      sessionId,
      tenantId,
    );
    const exists = await opts.redis.exists(bindKey);
    if (!exists) {
      res.status(404).json({ error: "unknown chat session" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as Response & { flushHeaders: () => void }).flushHeaders();
    }

    const sub = opts.redis.duplicate();
    const ch = chatNotifyRedisChannel(opts.definitionsKeyPrefix, sessionId);

    const writeEvent = (rawJson: string) => {
      res.write("event: chat\n");
      for (const line of rawJson.split("\n")) {
        res.write(`data: ${line}\n`);
      }
      res.write("\n");
    };

    const ping = setInterval(() => {
      res.write(": ping\n\n");
    }, 20_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      sub.removeAllListeners("message");
      void sub.unsubscribe(ch).catch(() => {});
      void sub.quit().catch(() => {});
      if (!res.writableEnded) res.end();
    };

    try {
      await sub.subscribe(ch);
    } catch (e) {
      writeEvent(
        JSON.stringify({
          kind: "stream_error",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      cleanup();
      return;
    }

    sub.on("message", (_c: string, message: string) => {
      writeEvent(message);
    });

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  return r;
}
