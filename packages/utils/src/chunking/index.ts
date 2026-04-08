import type { Chunk, ChunkOptions } from "./types.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildChunks(segments: string[], text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const start = text.indexOf(seg, offset);
    const so = start >= 0 ? start : offset;
    chunks.push({
      content: seg,
      index: i,
      startOffset: so,
      endOffset: so + seg.length,
      tokenCount: estimateTokens(seg),
    });
    offset = so + seg.length;
  }
  return chunks;
}

function fixedSize(text: string, maxTokens: number, overlap: number): string[] {
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;
  const segs: string[] = [];
  let i = 0;
  while (i < text.length) {
    segs.push(text.slice(i, i + maxChars));
    i += maxChars - overlapChars;
    if (i + overlapChars >= text.length && i < text.length) {
      segs.push(text.slice(i));
      break;
    }
  }
  return segs;
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [text];
}

function sentenceChunk(text: string, maxTokens: number, overlap: number): string[] {
  const sentences = splitSentences(text);
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;
  const segs: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length > maxChars && buf.length > 0) {
      segs.push(buf.trim());
      const tail = buf.slice(-overlapChars);
      buf = tail + s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

function paragraphChunk(text: string, maxTokens: number, overlap: number): string[] {
  const paras = text.split(/\n{2,}/);
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;
  const segs: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (p.length > maxChars) {
      if (buf.trim()) segs.push(buf.trim());
      buf = "";
      segs.push(...sentenceChunk(p, maxTokens, overlap));
      continue;
    }
    if (buf.length + p.length + 2 > maxChars && buf.length > 0) {
      segs.push(buf.trim());
      const tail = buf.slice(-overlapChars);
      buf = tail + "\n\n" + p;
    } else {
      buf += (buf ? "\n\n" : "") + p;
    }
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

function recursiveChunk(text: string, maxTokens: number, overlap: number): string[] {
  const paras = text.split(/\n{2,}/);
  if (paras.length > 1) return paragraphChunk(text, maxTokens, overlap);
  const sentences = splitSentences(text);
  if (sentences.length > 1) return sentenceChunk(text, maxTokens, overlap);
  return fixedSize(text, maxTokens, overlap);
}

/**
 * Split text into bounded chunks using the specified strategy.
 * Token counts are approximations (chars / 4).
 */
export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  const { method, maxTokens, overlap } = options;
  let segments: string[];
  switch (method) {
    case "fixed_size":
      segments = fixedSize(text, maxTokens, overlap);
      break;
    case "sentence":
      segments = sentenceChunk(text, maxTokens, overlap);
      break;
    case "paragraph":
      segments = paragraphChunk(text, maxTokens, overlap);
      break;
    case "recursive":
      segments = recursiveChunk(text, maxTokens, overlap);
      break;
    default:
      segments = recursiveChunk(text, maxTokens, overlap);
  }
  return buildChunks(segments, text);
}

export type { Chunk, ChunkOptions };
