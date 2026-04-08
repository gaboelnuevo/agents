# Agentic Labs RAG demo

This document is a tiny knowledge file for the `examples/rag` sample.

Retrieval-augmented generation combines **vector search** with an LLM. This demo registers this file in a catalog (`ingest_rag_source` by id), then runs `vector_search` on the chunks.

The pipeline uses chunking, embeddings, and an in-memory vector index (production would use something like `OpenAIEmbeddingAdapter` plus `UpstashVectorAdapter`).
