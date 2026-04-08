import type { AgentDefinitionPersisted } from "../define/types.js";
import type { Session } from "../define/Session.js";
import type { SecurityContext } from "../security/types.js";
import type { EngineDeps, EngineHooks } from "./types.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { ToolRunner } from "../tools/ToolRunner.js";
import type { AgentRuntime } from "../runtime/AgentRuntime.js";
import { resolveLlmAdapterForProvider } from "../runtime/resolveLlmAdapter.js";
import { resolveToolRegistry } from "../define/registry.js";
import {
  applyRuntimeToolAllowlist,
  effectiveToolAllowlist,
} from "../define/effectiveToolAllowlist.js";

/** Derives the engine `SecurityContext` from a loaded agent and session (same as `RunBuilder`). */
export function securityContextForAgent(
  session: Session,
  agent: AgentDefinitionPersisted,
): SecurityContext {
  return {
    principalId: "internal",
    kind: "internal",
    organizationId: session.projectId,
    projectId: session.projectId,
    endUserId: session.endUserId,
    roles: agent.security?.roles ?? ["agent"],
    scopes: agent.security?.scopes ?? ["*"],
  };
}

/**
 * Builds the static part of {@link EngineDeps} for {@link executeRun}.
 * Pass the result together with `startedAtMs`, and optionally `resumeMessages`.
 */
export function buildEngineDeps(
  agent: AgentDefinitionPersisted,
  session: Session,
  runtime: AgentRuntime,
  opts?: { hooks?: EngineHooks; signal?: AbortSignal },
): Omit<EngineDeps, "resumeMessages" | "startedAtMs"> {
  const cfg = runtime.config;
  const toolRegistry = resolveToolRegistry(session.projectId);
  const agentAllow = effectiveToolAllowlist(agent, session.projectId);
  const allow = applyRuntimeToolAllowlist(agentAllow, cfg.allowedToolIds);
  const runner = new ToolRunner(toolRegistry, allow, {
    toolTimeoutMs: cfg.toolTimeoutMs,
  });
  const cb = new ContextBuilder();
  const llmAdapter = resolveLlmAdapterForProvider(cfg, agent.llm?.provider);

  return {
    agent,
    session,
    fileReadRoot: session.fileReadRoot ?? cfg.fileReadRoot,
    memoryAdapter: cfg.memoryAdapter,
    llmAdapter,
    embeddingAdapter: cfg.embeddingAdapter,
    vectorAdapter: cfg.vectorAdapter,
    messageBus: cfg.messageBus,
    sendMessageTargetPolicy: cfg.sendMessageTargetPolicy,
    ragFileCatalog: runtime.ragCatalogForProject(session.projectId),
    toolRunner: runner,
    toolRegistry,
    contextBuilder: cb,
    securityContext: securityContextForAgent(session, agent),
    limits: {
      maxIterations: cfg.maxIterations ?? 25,
      maxParseRecovery: cfg.maxParseRecovery ?? 1,
      runTimeoutMs: cfg.runTimeoutMs ?? 120_000,
      toolTimeoutMs: cfg.toolTimeoutMs,
    },
    signal: opts?.signal,
    hooks: opts?.hooks,
  };
}
