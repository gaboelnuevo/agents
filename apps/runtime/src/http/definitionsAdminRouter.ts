/**
 * Redis-backed definition CRUD under `/v1/*` (not part of `@opencoreagents/rest-api`).
 * After each mutation, `onAfterMutation` replays the project into the in-process registry so
 * `createRuntimeRestRouter` can validate `POST /agents/:agentId/run`.
 */
import type { HttpToolConfig } from "@opencoreagents/adapters-http-tool";
import type { RedisDynamicDefinitionsStore } from "@opencoreagents/adapters-redis";
import {
  CORE_SYSTEM_TOOL_IDS,
  type AgentDefinitionPersisted,
  type SkillDefinitionPersisted,
  unregisterProjectSkill,
  unregisterProjectTool,
} from "@opencoreagents/core";
import type { ProjectDefinitionsSnapshot } from "@opencoreagents/dynamic-definitions";
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

/** Same logical names as `@opencoreagents/dynamic-planner` global tools — not overridable via HTTP tool rows. */
const DYNAMIC_PLANNER_TOOL_IDS = [
  "spawn_agent",
  "wait_for_agents",
  "reflect_and_retry",
  "list_available_tools",
  "list_available_models",
  "system_write_artifact",
  /** Runtime global — `registerRuntimeInvokePlannerTool` (`invokePlannerTool.ts`). */
  "invoke_planner",
  /** Runtime global — `registerRuntimeFetchRunTool` (`fetchRunTool.ts`). */
  "runtime_fetch_run",
] as const;

/** RAG / file tools registered when the runtime enables `@opencoreagents/rag` (ids must not collide). */
const RAG_TOOL_IDS = [
  "system_file_read",
  "system_file_list",
  "system_file_ingest",
  "system_list_rag_sources",
  "system_ingest_rag_source",
] as const;

/**
 * Tool ids owned by the engine, dynamic planner, or RAG — cannot be reused as HTTP **tool** ids or **agent** ids
 * (same global id namespace for tools; agent rows use a separate collection but must not collide by name).
 */
const RESERVED_TOOL_NAMESPACE_IDS = new Set<string>([
  ...CORE_SYSTEM_TOOL_IDS,
  ...DYNAMIC_PLANNER_TOOL_IDS,
  ...RAG_TOOL_IDS,
]);

/**
 * Default ids for the runtime-seeded planner row and lazy-seeded **`chat`** row — not overridable via **`PUT /v1/agents/...`**
 * (use stack **`planner.defaultAgent`** / **`chat.defaultAgent`** and env overrides for LLM rows).
 */
const RESERVED_RUNTIME_MANAGED_AGENT_IDS = new Set<string>(["planner", "chat"]);

/**
 * HTTP tools share the global tool namespace with built-ins and planner tools.
 * Reject ids that would shadow engine-registered tools or confuse the model.
 */
function assertHttpToolIdAllowed(toolId: string): void {
  const id = String(toolId).trim();
  if (!id) {
    throw new Error("toolId is required");
  }
  if (RESERVED_TOOL_NAMESPACE_IDS.has(id)) {
    throw new Error(
      `tool id '${id}' is reserved (engine built-in, RAG, or dynamic-planner tool — pick another id)`,
    );
  }
  if (id.startsWith("system_")) {
    throw new Error(
      "HTTP tool ids must not start with 'system_' (reserved namespace for engine built-ins)",
    );
  }
}

/**
 * Agent ids must not collide with built-in / planner / RAG **tool** names, the **`planner`** / **`chat`** runtime
 * defaults, or the `system_` prefix.
 */
function assertAgentIdAllowed(agentId: string): void {
  const id = String(agentId).trim();
  if (!id) {
    throw new Error("agentId is required");
  }
  if (RESERVED_RUNTIME_MANAGED_AGENT_IDS.has(id)) {
    throw new Error(
      `agent id '${id}' is reserved (runtime default planner or chat agent — tune via stack planner.defaultAgent / chat.defaultAgent, not PUT /v1/agents)`,
    );
  }
  if (RESERVED_TOOL_NAMESPACE_IDS.has(id)) {
    throw new Error(
      `agent id '${id}' is reserved (matches a built-in, RAG, or dynamic-planner tool id — pick another id)`,
    );
  }
  if (id.startsWith("system_")) {
    throw new Error(
      "agent ids must not start with 'system_' (reserved namespace for engine built-ins)",
    );
  }
}

function idMismatchResponse(
  res: Response,
  body: Record<string, unknown>,
  paramId: string,
  paramLabel: string,
): boolean {
  if (body.id != null && String(body.id) !== String(paramId)) {
    res.status(400).json({ error: `body.id must match :${paramLabel}` });
    return true;
  }
  return false;
}

/** Strip `_secrets` from HTTP tools in snapshots (should not be persisted; defense in depth for bad rows). */
function definitionsSnapshotForExport(snap: ProjectDefinitionsSnapshot): ProjectDefinitionsSnapshot {
  return {
    ...snap,
    httpTools: snap.httpTools.map((t) => {
      const rec = t as unknown as Record<string, unknown>;
      if (!("_secrets" in rec)) return t;
      const { _secrets: _ignored, ...rest } = rec;
      return rest as unknown as HttpToolConfig;
    }),
  };
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
      res.json(definitionsSnapshotForExport(snap));
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.put("/http-tools/:toolId", async (req, res) => {
    await withClientError(res, async () => {
      assertHttpToolIdAllowed(req.params.toolId);
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

  r.delete("/http-tools/:toolId", async (req, res) => {
    try {
      const id = String(req.params.toolId ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "toolId required" });
        return;
      }
      try {
        assertHttpToolIdAllowed(id);
      } catch (e) {
        res.status(400).json({ error: errorMessage(e) });
        return;
      }
      const removed = await store.methods.deleteHttpTool(projectId, id);
      if (!removed) {
        res.status(404).json({ error: "HTTP tool not found" });
        return;
      }
      unregisterProjectTool(projectId, id);
      await onAfterMutation();
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
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

  r.delete("/skills/:skillId", async (req, res) => {
    try {
      const id = String(req.params.skillId ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "skillId required" });
        return;
      }
      const removed = await store.methods.deleteSkill(projectId, id);
      if (!removed) {
        res.status(404).json({ error: "skill not found" });
        return;
      }
      unregisterProjectSkill(projectId, id);
      await onAfterMutation();
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  r.put("/agents/:agentId", async (req, res) => {
    await withClientError(res, async () => {
      assertAgentIdAllowed(req.params.agentId);
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
