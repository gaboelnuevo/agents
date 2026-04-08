import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";
import type { AgentDefinitionPersisted } from "./types.js";
import type { Session } from "./Session.js";
import type { Run } from "../protocol/types.js";
import type { Step } from "../protocol/types.js";
import type { EngineHooks, LLMResponseMeta, LLMParseOutcome } from "../engine/types.js";
import { createRun, executeRun } from "../engine/Engine.js";
import { buildEngineDeps } from "../engine/buildEngineDeps.js";
import { getEngineConfig } from "../runtime/configure.js";
import { RunInvalidStateError, SessionExpiredError } from "../errors/index.js";

function throwIfSessionExpired(session: Session): void {
  if (session.isExpired()) {
    throw new SessionExpiredError("Session has expired");
  }
}

function lastWaitStepFromRun(run: Run): Extract<Step, { type: "wait" }> | undefined {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const m = run.history[i]!;
    if (m.type !== "wait") continue;
    const c = m.content as { reason?: string; details?: unknown };
    return { type: "wait", reason: String(c.reason ?? ""), details: c.details };
  }
  return undefined;
}

export class RunBuilder implements PromiseLike<Run> {
  private readonly hooks: EngineHooks = {};
  private waitContinuation?: (step: Step) => Promise<string | undefined>;

  constructor(
    private readonly agent: AgentDefinitionPersisted,
    private readonly session: Session,
    private readonly init:
      | string
      | {
          runId: string;
          resumeInput: { type: string; content: string };
        },
  ) {}

  onThought(cb: (step: Step) => void): this {
    this.hooks.onThought = cb;
    return this;
  }

  onAction(cb: (step: Step) => void): this {
    this.hooks.onAction = cb;
    return this;
  }

  onObservation(cb: (obs: unknown) => void): this {
    this.hooks.onObservation = cb;
    return this;
  }

  /**
   * When the model returns `wait`, invoke `cb` with that step. If `cb` returns a string,
   * the run continues in-process (same as `resume` with `type: "text"`). If `cb` returns
   * `undefined`, the run stays `waiting` — use `Agent.resume` or persist via `runStore`.
   */
  onWait(cb: (step: Step) => Promise<string | undefined>): this {
    this.waitContinuation = cb;
    return this;
  }

  onLLMResponse(cb: (response: LLMResponse, meta: LLMResponseMeta) => void): this {
    const prev = this.hooks.onLLMResponse;
    this.hooks.onLLMResponse = (r, m) => {
      prev?.(r, m);
      cb(r, m);
    };
    return this;
  }

  onLLMAfterParse(
    cb: (
      response: LLMResponse,
      meta: LLMResponseMeta,
      outcome: LLMParseOutcome,
    ) => void,
  ): this {
    const prev = this.hooks.onLLMAfterParse;
    this.hooks.onLLMAfterParse = (r, m, o) => {
      prev?.(r, m, o);
      cb(r, m, o);
    };
    return this;
  }

  then<TResult1 = Run, TResult2 = never>(
    onfulfilled?: ((value: Run) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as never, onrejected as never);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<Run | TResult> {
    return this.execute().catch(onrejected as never);
  }

  private async execute(): Promise<Run> {
    throwIfSessionExpired(this.session);
    const cfg = getEngineConfig();

    let run: Run;
    let resumeMessages:
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined;

    if (typeof this.init === "string") {
      run = createRun(this.agent.id, this.session.id, this.init);
    } else {
      if (!cfg.runStore) {
        throw new RunInvalidStateError(
          "configureRuntime({ runStore }) is required for resume()",
        );
      }
      const loaded = await cfg.runStore.load(this.init.runId);
      if (!loaded) {
        throw new RunInvalidStateError(`Run not found: ${this.init.runId}`);
      }
      if (loaded.agentId !== this.agent.id) {
        throw new RunInvalidStateError(
          `Run ${this.init.runId} belongs to a different agent`,
        );
      }
      if (loaded.status !== "waiting") {
        throw new RunInvalidStateError(
          `Cannot resume run ${this.init.runId}: status is "${loaded.status}", expected "waiting"`,
        );
      }
      run = loaded;
      run.status = "running";
      run.state.pending = null;
      const { type, content } = this.init.resumeInput;
      resumeMessages = [
        {
          role: "user",
          content: `[resume:${type}] ${content}`,
        },
      ];
    }

    const baseDeps = buildEngineDeps(this.agent, this.session, { hooks: this.hooks });

    let result = await executeRun(run, {
      ...baseDeps,
      startedAtMs: Date.now(),
      resumeMessages,
    });

    if (cfg.runStore) {
      await cfg.runStore.save(result);
    }

    const isFreshRun = typeof this.init === "string";
    while (
      result.status === "waiting" &&
      isFreshRun &&
      this.waitContinuation
    ) {
      throwIfSessionExpired(this.session);
      const waitStep = lastWaitStepFromRun(result);
      if (!waitStep) break;
      const reply = await this.waitContinuation(waitStep);
      if (reply === undefined) break;

      result.status = "running";
      result.state.pending = null;

      result = await executeRun(result, {
        ...baseDeps,
        startedAtMs: Date.now(),
        resumeMessages: [
          {
            role: "user",
            content: `[resume:text] ${reply}`,
          },
        ],
      });

      if (cfg.runStore) {
        await cfg.runStore.save(result);
      }
    }

    return result;
  }
}
