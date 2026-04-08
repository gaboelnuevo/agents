import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";
import type { AgentDefinitionPersisted } from "./types.js";
import type { Session } from "./Session.js";
import type { Run } from "../protocol/types.js";
import type { Step } from "../protocol/types.js";
import type { RunStore } from "../adapters/run/RunStore.js";
import type { EngineHooks, LLMResponseMeta, LLMParseOutcome } from "../engine/types.js";
import { createRun, executeRun } from "../engine/Engine.js";
import { buildEngineDeps } from "../engine/buildEngineDeps.js";
import type { AgentRuntime } from "../runtime/AgentRuntime.js";
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
    private readonly runtime: AgentRuntime,
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

  /**
   * After `executeRun`, persist with compare-and-swap when advancing from a **`waiting`** row
   * (`Agent.resume` or in-process `onWait` after a prior save that left `waiting`).
   */
  private async persistAfterExecute(
    store: RunStore,
    result: Run,
    opts: { resumePath: boolean; lastPersistedWasWaiting: boolean },
  ): Promise<void> {
    const useCas = opts.resumePath || opts.lastPersistedWasWaiting;
    if (useCas) {
      const ok = await store.saveIfStatus(result, "waiting");
      if (!ok) {
        throw new RunInvalidStateError(
          `Run ${result.runId} is no longer waiting (concurrent resume or stale job)`,
        );
      }
      return;
    }
    await store.save(result);
  }

  private async execute(): Promise<Run> {
    throwIfSessionExpired(this.session);
    const cfg = this.runtime.config;

    let run: Run;
    let resumeMessages:
      | Array<{ role: "user" | "assistant"; content: string }>
      | undefined;

    if (typeof this.init === "string") {
      run = createRun(this.agent.id, this.session.id, this.init);
    } else {
      if (!cfg.runStore) {
        throw new RunInvalidStateError(
          "AgentRuntime({ runStore }) is required for resume()",
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
      if (
        loaded.sessionId != null &&
        loaded.sessionId !== this.session.id
      ) {
        throw new RunInvalidStateError(
          `Run ${this.init.runId} belongs to a different session`,
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

    const baseDeps = buildEngineDeps(this.agent, this.session, this.runtime, {
      hooks: this.hooks,
    });

    let lastPersistedWasWaiting = false;
    let result = await executeRun(run, {
      ...baseDeps,
      startedAtMs: Date.now(),
      resumeMessages,
    });

    if (cfg.runStore) {
      await this.persistAfterExecute(cfg.runStore, result, {
        resumePath: typeof this.init !== "string",
        lastPersistedWasWaiting,
      });
      lastPersistedWasWaiting = result.status === "waiting";
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
        await this.persistAfterExecute(cfg.runStore, result, {
          resumePath: false,
          lastPersistedWasWaiting,
        });
        lastPersistedWasWaiting = result.status === "waiting";
      }
    }

    return result;
  }
}
