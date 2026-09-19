import { RetrievedChunk } from '../../retrieval/types/retrieval.type.js';

export type ChatEvent =
  | { type: 'sources'; sources: SourceSnapshot[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number }
  | { type: 'error'; message: string };

export type ChatContext = {
  chunks: RetrievedChunk[];
  query: string;
  question: string;
  conversationId: number;
};

export type SourceSnapshot = {
  chunkId: number;
  documentId: number;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
};
