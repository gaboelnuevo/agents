export interface ParseResult {
  text: string;
  metadata: {
    mimeType: string;
    pages?: number;
    encoding?: string;
    title?: string;
  };
}
