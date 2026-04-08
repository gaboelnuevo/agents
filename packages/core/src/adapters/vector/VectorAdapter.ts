export interface VectorDocument {
  id: string;
  vector: number[];
  data: string;
  metadata?: Record<string, unknown>;
}

export interface VectorQuery {
  vector: number[];
  topK: number;
  filter?: Record<string, unknown>;
  includeData?: boolean;
  includeMetadata?: boolean;
  scoreThreshold?: number;
}

export interface VectorResult {
  id: string;
  score: number;
  data?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorDeleteParams {
  ids?: string[];
  filter?: Record<string, unknown>;
  deleteAll?: boolean;
}

export interface VectorAdapter {
  upsert(namespace: string, documents: VectorDocument[]): Promise<void>;
  query(namespace: string, params: VectorQuery): Promise<VectorResult[]>;
  delete(namespace: string, params: VectorDeleteParams): Promise<void>;
}
