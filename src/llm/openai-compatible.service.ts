import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { LlmService } from './llm.service.js';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import type { ChatMessage, ChatOptions } from './types/llm.type.js';

@Injectable()
export class OpenAiCompatibleService extends LlmService {
  private readonly client: OpenAI;
  private readonly embeddingModel: string;
  private readonly embeddingDimensions: number;
  private readonly chatModel: string;
  private readonly temperature: number;
  private readonly logger = new Logger(OpenAiCompatibleService.name);

  constructor(private readonly config: ConfigService) {
    super();
    this.client = new OpenAI({
      baseURL: this.config.getOrThrow<string>('LLM_BASE_URL'),
      apiKey: this.config.getOrThrow<string>('LLM_API_KEY'),
    });
    this.embeddingModel = this.config.getOrThrow<string>('LLM_EMBEDDING_MODEL');
    this.embeddingDimensions = Number(
      this.config.getOrThrow<string>('LLM_EMBEDDING_DIMENSIONS'),
    );
    this.chatModel = this.config.getOrThrow<string>('LLM_CHAT_MODEL');
    this.temperature = Number(
      this.config.getOrThrow<string>('LLM_TEMPERATURE'),
    );
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: options?.model ?? this.chatModel,
        messages,
        stream: false,
        temperature: options?.temperature ?? this.temperature,
      });
      return res.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.error('chat 调用失败', error);
      throw new InternalServerErrorException('chat 调用失败');
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options?.model ?? this.chatModel,
        messages,
        stream: true,
        temperature: options?.temperature ?? this.temperature,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
    } catch (error) {
      this.logger.error('流式 chat 调用失败', error);
      throw new InternalServerErrorException('流式 chat 调用失败');
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      if (texts.length === 0) {
        return [];
      }
      const res = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: texts,
        dimensions: this.embeddingDimensions,
      });
      return res.data.map((item) => item.embedding);
    } catch (error) {
      this.logger.error('embedding 调用失败', error);
      throw new InternalServerErrorException('向量化失败');
    }
  }
}
