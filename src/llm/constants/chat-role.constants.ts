export const CHAT_ROLE_TYPE = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
} as const;

export type ChatRoleType = (typeof CHAT_ROLE_TYPE)[keyof typeof CHAT_ROLE_TYPE];
