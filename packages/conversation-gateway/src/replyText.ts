import type { Run } from "@agent-runtime/core";

/**
 * Best-effort assistant reply string from run history (last `result` step).
 * Replace with structured handling if your agent emits non-string payloads.
 */
export function replyTextFromRun(run: Run): string {
  const lastResult = [...run.history].reverse().find((h) => h.type === "result");
  if (!lastResult) return "";
  const c = lastResult.content;
  return typeof c === "string" ? c : JSON.stringify(c);
}
