import {
  LLMClientError,
  LLMRateLimitError,
  LLMTransportError,
  RunCancelledError,
} from "@agent-runtime/core";

/** Maps OpenAI HTTP status to engine LLM errors (plan Phase 3.2). */
export function throwForOpenAIHttpStatus(status: number, detail: string): never {
  const msg = detail.length > 500 ? detail.slice(0, 500) : detail;
  const full = `OpenAI HTTP ${status}: ${msg}`;
  if (status === 429) throw new LLMRateLimitError(full);
  if (status >= 500) throw new LLMTransportError(full);
  throw new LLMClientError(full);
}

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as Error).name === "AbortError";
}

/** Network / DNS failures from `fetch`, or `AbortError` when the request was cancelled. */
export function rethrowFetchFailure(e: unknown, context: string): never {
  if (isAbortError(e)) {
    throw new RunCancelledError(e instanceof Error ? e.message : String(e));
  }
  const msg = e instanceof Error ? e.message : String(e);
  throw new LLMTransportError(`${context}: ${msg}`);
}
