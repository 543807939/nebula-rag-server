import type { ChatMessage, ChatOptions } from './types/llm.type.js';

export abstract class LlmService {
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string>;
  abstract chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string>;
  abstract embed(texts: string[]): Promise<number[][]>;
}
