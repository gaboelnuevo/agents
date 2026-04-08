import type { Run } from "@agent-runtime/core";

export function printRunSummary(run: Run): void {
  console.log("status:", run.status);
  for (const h of run.history) {
    if (h.type === "action") {
      const c = h.content as { tool?: string; input?: unknown };
      console.log("action:", c.tool, JSON.stringify(c.input));
    } else if (h.type === "observation") {
      const o = h.content as { success?: boolean; results?: unknown[]; chunksCreated?: number };
      if (Array.isArray(o.results)) {
        console.log(
          "observation: vector_search hits:",
          o.results.length,
          "top score:",
          (o.results[0] as { score?: number } | undefined)?.score,
        );
      } else {
        console.log("observation:", JSON.stringify(o).slice(0, 500));
      }
    } else if (h.type === "result") {
      console.log("result:", h.content);
    }
  }
}
