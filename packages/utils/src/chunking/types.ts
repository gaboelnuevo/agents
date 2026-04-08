export interface ChunkOptions {
  method: "fixed_size" | "sentence" | "paragraph" | "recursive";
  maxTokens: number;
  overlap: number;
}

export interface Chunk {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}
