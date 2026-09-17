export const DOCUMENT_STATUS = {
  PENDING: 'pending', // 落库待处理
  PROCESSING: 'processing', // 处理中
  COMPLETED: 'completed', // 处理完成
  FAILED: 'failed', // 处理失败
} as const;

export type DocumentStatus =
  (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];
