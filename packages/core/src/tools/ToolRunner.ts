import type { ToolAdapter, ToolContext } from "../adapters/tool/ToolAdapter.js";
import {
  ToolExecutionError,
  ToolNotAllowedError,
  ToolTimeoutError,
  ToolValidationError,
} from "../errors/index.js";

function validationFailureMessage(toolName: string, reason?: string): string {
  const base = `Validation failed for tool: ${toolName}`;
  return reason && reason.trim() ? `${base}: ${reason.trim()}` : base;
}

export interface ToolRunnerOptions {
  /** When set (> 0), `execute` rejects with {@link ToolTimeoutError} if the tool does not settle in time. */
  toolTimeoutMs?: number;
}

export class ToolRunner {
  constructor(
    private readonly registry: Map<string, ToolAdapter>,
    private readonly allowlist: Set<string>,
    private readonly options: ToolRunnerOptions = {},
  ) {}

  register(tool: ToolAdapter): void {
    this.registry.set(tool.name, tool);
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<unknown> {
    if (!this.allowlist.has(name)) {
      throw new ToolNotAllowedError(`Tool not allowed for agent: ${name}`);
    }
    const tool = this.registry.get(name);
    if (!tool) {
      throw new ToolExecutionError(`Unknown tool: ${name}`);
    }
    if (tool.validate) {
      const validation = tool.validate(input);
      const ok =
        typeof validation === "boolean" ? validation : Boolean(validation && validation.ok);
      if (!ok) {
        const reason =
          validation && typeof validation === "object" && !Array.isArray(validation)
            ? validation.reason
            : undefined;
        throw new ToolValidationError(validationFailureMessage(name, reason), reason);
      }
    }
    const run = tool.execute(input, context);
    const bounded =
      this.options.toolTimeoutMs != null && this.options.toolTimeoutMs > 0
        ? raceWithTimeout(run, this.options.toolTimeoutMs, name)
        : run;
    try {
      return await bounded;
    } catch (e) {
      if (e instanceof ToolTimeoutError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new ToolExecutionError(msg);
    }
  }
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ToolTimeoutError(`Tool timed out after ${ms}ms: ${toolName}`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
