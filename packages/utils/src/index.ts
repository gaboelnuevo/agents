export { parseFile, registerParser } from "./parsers/index.js";
export type { ParseResult } from "./parsers/types.js";

export { chunkText } from "./chunking/index.js";
export type { Chunk, ChunkOptions } from "./chunking/types.js";

export {
  resolveSource,
  FileOutsideRootError,
  HttpSourceNotAllowedError,
} from "./file-resolver/index.js";
export type { ResolveSourceOptions } from "./file-resolver/index.js";
export type { ResolvedFile } from "./file-resolver/types.js";
