export interface RetrievalOptions {
  topK?: number;
}

export interface RetrievedChunk {
  id: number;
  documentId: number;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
}
