import type { AgentDefinitionPersisted } from "../define/types.js";
import type { Session } from "../define/Session.js";
import type { SecurityContext } from "../security/types.js";
import type { EngineDeps, EngineHooks } from "./types.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { ToolRunner } from "../tools/ToolRunner.js";
import { getEngineConfig } from "../runtime/configure.js";
import { resolveToolRegistry } from "../define/registry.js";
import { effectiveToolAllowlist } from "../define/effectiveToolAllowlist.js";

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
 * Builds the static part of {@link EngineDeps} after `configureRuntime` and agent/skill registration.
 * Pass the result to {@link executeRun} together with `startedAtMs`, and optionally `resumeMessages`.
 */
export function buildEngineDeps(
  agent: AgentDefinitionPersisted,
  session: Session,
  opts?: { hooks?: EngineHooks; signal?: AbortSignal },
): Omit<EngineDeps, "resumeMessages" | "startedAtMs"> {
  const cfg = getEngineConfig();
  const toolRegistry = resolveToolRegistry(session.projectId);
  const allow = effectiveToolAllowlist(agent, session.projectId);
  const runner = new ToolRunner(toolRegistry, allow, {
    toolTimeoutMs: cfg.toolTimeoutMs,
  });
  const cb = new ContextBuilder();

  return {
    agent,
    session,
    memoryAdapter: cfg.memoryAdapter,
    llmAdapter: cfg.llmAdapter,
    embeddingAdapter: cfg.embeddingAdapter,
    vectorAdapter: cfg.vectorAdapter,
    messageBus: cfg.messageBus,
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
