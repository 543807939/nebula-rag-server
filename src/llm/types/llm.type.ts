import { ChatRoleType } from '../constants/chat-role.constants.js';

export interface ChatMessage {
  role: ChatRoleType;
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  model?: string; // 允许单次覆盖默认模型
}
