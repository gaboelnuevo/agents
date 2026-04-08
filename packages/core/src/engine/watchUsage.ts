import type { LLMResponse } from "../adapters/llm/LLMAdapter.js";
import type { LLMResponseMeta } from "./types.js";
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
    llmCalls: 0,
  };

  builder.onLLMResponse((res: LLMResponse, meta: LLMResponseMeta) => {
    usage.agentId = meta.agentId;
    usage.runId = meta.runId;
    if (res.usage) {
      usage.promptTokens += res.usage.promptTokens ?? 0;
      usage.completionTokens += res.usage.completionTokens ?? 0;
      usage.totalTokens += res.usage.totalTokens ?? 0;
    }
    usage.llmCalls++;
  });

  return {
    builder,
    getUsage: () => ({ ...usage }),
  };
}
