/**
 * Redis-backed definition CRUD under `/v1/*` (not part of `@opencoreagents/rest-api`).
 * After each mutation, `onAfterMutation` replays the project into the in-process registry so
 * `createRuntimeRestRouter` can validate `POST /agents/:agentId/run`.
 */
import type { HttpToolConfig } from "@opencoreagents/adapters-http-tool";
import type { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import type { AgentDefinitionPersisted, SkillDefinitionPersisted } from "@opencoreagents/core";
import { Router, type Response } from "express";
import express from "express";

export interface DefinitionsAdminRouterDeps {
  store: RedisDynamicDefinitionsStore;
  projectId: string;
  onAfterMutation: () => Promise<void>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function idMismatchResponse(
  res: Response,
  body: Record<string, unknown>,
  paramId: string,
  paramLabel: string,
): boolean {
  if (body.id != null && body.id !== paramId) {
    res.status(400).json({ error: `body.id must match :${paramLabel}` });
    return true;
  }
  return false;
}

async function withClientError(res: Response, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    res.status(400).json({ error: errorMessage(e) });
  }
}

export function createDefinitionsAdminRouter(deps: DefinitionsAdminRouterDeps): Router {
  const { store, projectId, onAfterMutation } = deps;
  const r = Router();
  r.use(express.json({ limit: "512kb" }));

  r.get("/definitions", async (_req, res) => {
    try {
      const snap = await store.methods.getSnapshot(projectId);
      res.json(snap);
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.put("/http-tools/:toolId", async (req, res) => {
    await withClientError(res, async () => {
      const body = req.body as Record<string, unknown>;
      if (idMismatchResponse(res, body, req.params.toolId, "toolId")) return;
      const secrets =
        typeof body._secrets === "object" && body._secrets !== null
          ? (body._secrets as Record<string, string>)
          : {};
      const { _secrets: _s, ...config } = body;
      const full = { ...config, id: req.params.toolId, projectId } as HttpToolConfig;
      await store.HttpTool.define(full, { secrets });
      await onAfterMutation();
      res.json({ ok: true, id: req.params.toolId });
    });
  });

  r.put("/skills/:skillId", async (req, res) => {
    await withClientError(res, async () => {
      const body = req.body as Record<string, unknown>;
      if (idMismatchResponse(res, body, req.params.skillId, "skillId")) return;
      const skill = {
        ...body,
        id: req.params.skillId,
        projectId,
        tools: body.tools ?? [],
      } as SkillDefinitionPersisted;
      await store.Skill.define(skill);
      await onAfterMutation();
      res.json({ ok: true, id: req.params.skillId });
    });
  });

  r.put("/agents/:agentId", async (req, res) => {
    await withClientError(res, async () => {
      const body = req.body as Record<string, unknown>;
      if (idMismatchResponse(res, body, req.params.agentId, "agentId")) return;
      const agent = {
        ...body,
        id: req.params.agentId,
        projectId,
      } as AgentDefinitionPersisted;
      await store.Agent.define(agent);
      await onAfterMutation();
      res.json({ ok: true, id: req.params.agentId });
    });
  });

  return r;
}
