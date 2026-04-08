import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";
import type { LLMResponseMeta, LLMParseOutcome } from "./types.js";
import type { RunBuilder } from "../define/RunBuilder.js";

export interface UsageContext {
  projectId: string;
  organizationId: string;
}

export interface UsageSnapshot {
  projectId: string;
  organizationId: string;
  agentId: string;
  runId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens from LLM calls whose output failed `parseStep` (recoverable retry or fatal). */
  wastedPromptTokens: number;
  wastedCompletionTokens: number;
  wastedTotalTokens: number;
  llmCalls: number;
}

export function watchUsage(
  builder: RunBuilder,
  context: UsageContext,
): { builder: RunBuilder; getUsage: () => UsageSnapshot } {
  const usage: UsageSnapshot = {
    projectId: context.projectId,
    organizationId: context.organizationId,
    agentId: "",
    runId: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    wastedPromptTokens: 0,
    wastedCompletionTokens: 0,
    wastedTotalTokens: 0,
    llmCalls: 0,
  };

  builder.onLLMAfterParse(
    (res: LLMResponse, meta: LLMResponseMeta, outcome: LLMParseOutcome) => {
      usage.agentId = meta.agentId;
      usage.runId = meta.runId;
      if (res.usage) {
        const p = res.usage.promptTokens ?? 0;
        const c = res.usage.completionTokens ?? 0;
        const t = res.usage.totalTokens ?? 0;
        usage.promptTokens += p;
        usage.completionTokens += c;
        usage.totalTokens += t;
        if (outcome !== "parsed") {
          usage.wastedPromptTokens += p;
          usage.wastedCompletionTokens += c;
          usage.wastedTotalTokens += t;
        }
      }
      usage.llmCalls++;
    },
  );

  return {
    builder,
    getUsage: () => ({ ...usage }),
  };
}
