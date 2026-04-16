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

type RunBuilderInit =
  | string
  | {
      userInput: string;
      runId?: string;
    }
  | {
      runId: string;
      resumeInput: { type: string; content: string };
    }
  | {
      runId: string;
      continueUserInput: string;
    };

function isContinueInit(
  init: RunBuilderInit,
): init is { runId: string; continueUserInput: string } {
  return typeof init !== "string" && "continueUserInput" in init;
}

function isResumeInit(
  init: RunBuilderInit,
): init is { runId: string; resumeInput: { type: string; content: string } } {
  return typeof init !== "string" && "resumeInput" in init;
}

function isNewRunWithOptionalId(
  init: RunBuilderInit,
): init is { userInput: string; runId?: string } {
  return typeof init !== "string" && "userInput" in init;
}

export class RunBuilder implements PromiseLike<Run> {
  private readonly hooks: EngineHooks = {};
  private waitContinuation?: (step: Step) => Promise<string | undefined>;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly agent: AgentDefinitionPersisted,
    private readonly session: Session,
    private readonly init: RunBuilderInit,
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
   * When **`executeRun`** throws after **`continueRun`** CAS (**`completed`/`failed` → `running`**) or after a
   * **`resume`** while Redis still shows **`waiting`**, the store would otherwise stay non-terminal and
   * HTTP chat would keep returning **`run_in_progress`** / **`run_waiting`**. Persist terminal state here.
   */
  private async persistExecuteFailure(
    store: RunStore,
    run: Run,
    cas: "running" | "waiting" | null,
  ): Promise<void> {
    if (
      run.status !== "failed" &&
      run.status !== "completed" &&
      run.status !== "waiting"
    ) {
      run.status = "failed";
    }
    if (cas === "running" || cas === "waiting") {
      const ok = await store.saveIfStatus(run, cas);
      if (!ok) {
        await store.save(run);
      }
      return;
    }
    await store.save(run);
  }

  /**
   * After `executeRun`, persist with compare-and-swap when advancing from a **`waiting`** row
   * (`Agent.resume` or in-process `onWait` after a prior save that left `waiting`), or from **`running`**
   * after **`Agent.continueRun`** (initial CAS already moved **`completed` → `running`** or
   * **`failed` → `running`**).
   */
  private async persistAfterExecute(
    store: RunStore,
    result: Run,
    opts: { resumePath: boolean; lastPersistedWasWaiting: boolean; continuePath: boolean },
  ): Promise<void> {
    const useResumeCas = opts.resumePath || opts.lastPersistedWasWaiting;
    if (useResumeCas) {
      const ok = await store.saveIfStatus(result, "waiting");
      if (!ok) {
        throw new RunInvalidStateError(
          `Run ${result.runId} is no longer waiting (concurrent resume or stale job)`,
        );
      }
      return;
    }
    if (opts.continuePath) {
      const ok = await store.saveIfStatus(result, "running");
      if (!ok) {
        throw new RunInvalidStateError(
          `Run ${result.runId} is no longer running (concurrent job or stale state)`,
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
      run = createRun(this.agent.id, this.session.id, this.init, this.session.projectId);
    } else if (isNewRunWithOptionalId(this.init)) {
      run = createRun(
        this.agent.id,
        this.session.id,
        this.init.userInput,
        this.session.projectId,
        this.init.runId,
      );
    } else if (isContinueInit(this.init)) {
      if (!cfg.runStore) {
        throw new RunInvalidStateError(
          "AgentRuntime({ runStore }) is required for continueRun()",
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
      if (loaded.status !== "completed" && loaded.status !== "failed") {
        throw new RunInvalidStateError(
          `Cannot continue run ${this.init.runId}: status is "${loaded.status}", expected "completed" or "failed"`,
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
      if (
        loaded.projectId != null &&
        loaded.projectId !== this.session.projectId
      ) {
        throw new RunInvalidStateError(
          `Run ${this.init.runId} belongs to a different project`,
        );
      }
      if (loaded.projectId == null) {
        loaded.projectId = this.session.projectId;
      }
      const cont = String(this.init.continueUserInput ?? "").trim();
      if (!cont) {
        throw new RunInvalidStateError("continueRun: userInput is required");
      }
      const priorStatus = loaded.status;
      run = loaded;
      run.status = "running";
      run.state.pending = null;
      run.state.iteration = 0;
      run.state.parseAttempts = 0;
      resumeMessages = [
        {
          role: "user",
          content: `[continue:user] ${cont}`,
        },
      ];
      const ok = await cfg.runStore.saveIfStatus(
        run,
        priorStatus === "failed" ? "failed" : "completed",
      );
      if (!ok) {
        throw new RunInvalidStateError(
          `Run ${this.init.runId} is no longer ${priorStatus} (concurrent continue or stale job)`,
        );
      }
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
      if (
        loaded.projectId != null &&
        loaded.projectId !== this.session.projectId
      ) {
        throw new RunInvalidStateError(
          `Run ${this.init.runId} belongs to a different project`,
        );
      }
      if (loaded.projectId == null) {
        loaded.projectId = this.session.projectId;
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

    const failureCasForPrimaryExecute = (): "running" | "waiting" | null => {
      if (isContinueInit(this.init)) return "running";
      if (isResumeInit(this.init)) return "waiting";
      return null;
    };

    let lastPersistedWasWaiting = false;
    let result: Run;
    try {
      result = await executeRun(run, {
        ...baseDeps,
        startedAtMs: Date.now(),
        resumeMessages,
      });
    } catch (e) {
      if (cfg.runStore) {
        await this.persistExecuteFailure(cfg.runStore, run, failureCasForPrimaryExecute());
      }
      throw e;
    }

    if (cfg.runStore) {
      await this.persistAfterExecute(cfg.runStore, result, {
        resumePath: isResumeInit(this.init),
        lastPersistedWasWaiting,
        continuePath: isContinueInit(this.init),
      });
      lastPersistedWasWaiting = result.status === "waiting";
    }

    const isFreshRun = typeof this.init === "string" || isNewRunWithOptionalId(this.init);
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

      try {
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
      } catch (e) {
        if (cfg.runStore) {
          await this.persistExecuteFailure(cfg.runStore, result, "waiting");
        }
        throw e;
      }

      if (cfg.runStore) {
        await this.persistAfterExecute(cfg.runStore, result, {
          resumePath: false,
          lastPersistedWasWaiting,
          continuePath: false,
        });
        lastPersistedWasWaiting = result.status === "waiting";
      }
    }

    return result;
  }
}
