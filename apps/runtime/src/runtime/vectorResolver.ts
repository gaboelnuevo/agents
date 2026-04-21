import { RedisStackVectorAdapter, type RedisStackVectorAdapterOptions } from "@opencoreagents/adapters-redis";
import { OpenAIEmbeddingAdapter } from "@opencoreagents/adapters-openai";
import type Redis from "ioredis";
import type { EmbeddingAdapter, VectorAdapter } from "@opencoreagents/core";
import type { ResolvedRuntimeStackConfig } from "../config/types.js";

export function buildVectorStackFromConfig(
  config: ResolvedRuntimeStackConfig,
  redis: Redis,
): {
  embeddingAdapter?: EmbeddingAdapter;
  vectorAdapter?: VectorAdapter;
} {
  if (!config.vector.enabled) return {};

  const openaiApiKey = config.llm.openai.apiKey.trim();
  if (!openaiApiKey) {
    throw new Error(
      "vector.enabled=true requires llm.openai.apiKey so OpenAI embeddings can be generated.",
    );
  }

  const base = config.llm.openai.baseUrl.trim();
  const embeddingModel = config.vector.openai.embeddingModel.trim();
  const embeddingAdapter = base
    ? new OpenAIEmbeddingAdapter(openaiApiKey, embeddingModel, base)
    : new OpenAIEmbeddingAdapter(openaiApiKey, embeddingModel);

  const vectorOpts: RedisStackVectorAdapterOptions = {
    indexPrefix: config.vector.indexPrefix,
    keyPrefix: config.vector.keyPrefix,
    distanceMetric: config.vector.distanceMetric,
    queryExpansionFactor: config.vector.queryExpansionFactor,
  };

  return {
    embeddingAdapter,
    vectorAdapter: new RedisStackVectorAdapter(redis, vectorOpts),
  };
}
