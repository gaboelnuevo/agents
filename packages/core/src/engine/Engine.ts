import { randomUUID } from "node:crypto";
import type { EngineDeps, EngineHooks } from "./types.js";
import type { Run } from "../protocol/types.js";
import type { Step } from "../protocol/types.js";
import type { ToolContext } from "../adapters/tool/ToolAdapter.js";
import { normalizeLlmStepContent } from "./normalizeLlmStepContent.js";
import { parseStep } from "./parseStep.js";
import { observationForToolFailure } from "./toolFailureObservation.js";
import {
  MaxIterationsError,
  RunCancelledError,
  RunTimeoutError,
  StepSchemaError,
} from "../errors/index.js";

function isoNow(): string {
  return new Date().toISOString();
}

function appendThought(run: Run, content: string): void {
  run.history.push({
    type: "thought",
    content,
    meta: { ts: isoNow(), source: "llm" },
  });
}

function appendAction(run: Run, step: Extract<Step, { type: "action" }>): void {
  run.history.push({
    type: "action",
    content: { tool: step.tool, input: step.input },
    meta: { ts: isoNow(), source: "llm" },
  });
}

function appendObservation(run: Run, content: unknown): void {
  run.history.push({
    type: "observation",
    content,
    meta: { ts: isoNow(), source: "tool" },
  });
}

function appendWait(run: Run, step: Extract<Step, { type: "wait" }>): void {
  run.history.push({
    type: "wait",
    content: { reason: step.reason, details: step.details },
    meta: { ts: isoNow(), source: "llm" },
  });
}

function appendResult(run: Run, content: string): void {
  run.history.push({
    type: "result",
    content,
    meta: { ts: isoNow(), source: "llm" },
  });
}

function toolContext(deps: EngineDeps, run: Run): ToolContext {
  const ctx: ToolContext & Record<string, unknown> = {
    projectId: deps.session.projectId,
    agentId: deps.agent.id,
    runId: run.runId,
    sessionId: deps.session.id,
    endUserId: deps.session.endUserId,
    memoryAdapter: deps.memoryAdapter,
    securityContext: deps.securityContext,
    fileReadRoot: deps.fileReadRoot ?? deps.session.fileReadRoot,
    allowFileReadOutsideRoot: deps.session.allowFileReadOutsideRoot,
    allowHttpFileSources: deps.session.allowHttpFileSources,
    httpFileSourceHostsAllowlist: deps.session.httpFileSourceHostsAllowlist,
  };
  if (deps.embeddingAdapter) ctx.embeddingAdapter = deps.embeddingAdapter;
  if (deps.vectorAdapter) ctx.vectorAdapter = deps.vectorAdapter;
  if (deps.messageBus) ctx.messageBus = deps.messageBus;
  if (deps.sendMessageTargetPolicy)
    ctx.sendMessageTargetPolicy = deps.sendMessageTargetPolicy;
  if (deps.ragFileCatalog !== undefined) ctx.ragFileCatalog = deps.ragFileCatalog;
  return ctx;
}

/**
 * Creates a new {@link Run} for {@link executeRun}. Prefer {@link Agent.run} / {@link RunBuilder};
 * with {@link buildEngineDeps} for the static part of {@link EngineDeps} when wiring queue workers or tests.
 */
export function createRun(
  agentId: string,
  sessionId: string | undefined,
  userInput: string,
): Run {
  return {
    runId: randomUUID(),
    agentId,
    sessionId,
    status: "running",
    history: [],
    state: {
      iteration: 0,
      pending: null,
      parseAttempts: 0,
      userInput,
    },
  };
}

/**
 * Runs the thought → action → observation loop until `result`, `wait`, failure, or max iterations.
 * Prefer {@link buildEngineDeps} for the static part of {@link EngineDeps}, then add
 * `startedAtMs` and optional `resumeMessages`. Adapters come from {@link AgentRuntime}.
 */
export async function executeRun(run: Run, deps: EngineDeps): Promise<Run> {
  run.status = "running";
  const { limits } = deps;
  let firstBuild = true;

  while (run.state.iteration < limits.maxIterations) {
    if (Date.now() - deps.startedAtMs > limits.runTimeoutMs) {
      run.status = "failed";
      throw new RunTimeoutError();
    }
    if (deps.signal?.aborted) {
      run.status = "failed";
      throw new RunCancelledError();
    }

    const recoveryMessages = run.state.parseRecovery as
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined;
    delete run.state.parseRecovery;

    const built = await deps.contextBuilder.build({
      agent: deps.agent,
      run,
      session: deps.session,
      memoryAdapter: deps.memoryAdapter,
      securityContext: deps.securityContext,
      toolRegistry: deps.toolRegistry,
      resumeMessages:
        firstBuild && deps.resumeMessages?.length ? deps.resumeMessages : undefined,
      recoveryMessages,
    });
    firstBuild = false;

    const llmResponseRaw = await deps.llmAdapter.generate({
      provider: deps.agent.llm!.provider,
      model: deps.agent.llm!.model,
      messages: built.messages,
      tools: built.tools,
      toolChoice: built.toolChoice,
      responseFormat: built.responseFormat,
      temperature:
        typeof deps.agent.llm?.temperature === "number"
          ? deps.agent.llm.temperature
          : 0.2,
      signal: deps.signal,
    });

    const hooks = deps.hooks as EngineHooks | undefined;
    const llmMeta = {
      agentId: deps.agent.id,
      runId: run.runId,
    };
    hooks?.onLLMResponse?.(llmResponseRaw, llmMeta);

    const llmResponse = normalizeLlmStepContent(llmResponseRaw);

    let step: Step;
    try {
      step = parseStep(llmResponse.content);
      run.state.parseAttempts = 0;
      hooks?.onLLMAfterParse?.(llmResponse, llmMeta, "parsed");
    } catch {
      const pa = (run.state.parseAttempts ?? 0) + 1;
      run.state.parseAttempts = pa;
      if (pa <= limits.maxParseRecovery) {
        hooks?.onLLMAfterParse?.(llmResponse, llmMeta, "parse_failed_recoverable");
        run.state.parseRecovery = [
          {
            role: "assistant",
            content: llmResponse.content.slice(0, 4000),
          },
          {
            role: "user",
            content:
              "Your last output was not valid JSON. Return only one JSON object with type and required fields.",
          },
        ];
        continue;
      }
      hooks?.onLLMAfterParse?.(llmResponse, llmMeta, "parse_failed_fatal");
      run.status = "failed";
      throw new StepSchemaError("Exceeded parse recovery attempts");
    }

    switch (step.type) {
      case "thought": {
        appendThought(run, step.content);
        hooks?.onThought?.(step);
        break;
      }
      case "action": {
        appendAction(run, step);
        hooks?.onAction?.(step);
        let obs: unknown;
        try {
          obs = await deps.toolRunner.execute(
            step.tool,
            step.input,
            toolContext(deps, run),
          );
        } catch (e) {
          obs = observationForToolFailure(e);
        }
        appendObservation(run, obs);
        hooks?.onObservation?.(obs);
        break;
      }
      case "wait": {
        appendWait(run, step);
        run.status = "waiting";
        run.state.pending = { reason: step.reason, details: step.details };
        hooks?.onWait?.(step);
        return run;
      }
      case "result": {
        appendResult(run, step.content);
        run.status = "completed";
        return run;
      }
      default: {
        const _exhaustive: never = step;
        void _exhaustive;
      }
    }

    run.state.iteration++;
  }

  run.status = "failed";
  throw new MaxIterationsError();
}
