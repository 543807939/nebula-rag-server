export const DOCUMENT_STATUS = {
  PENDING: 'pending',
} as const;

export type DocumentStatus =
  (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];
