import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../src/llm/llm.service.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * 手动冒烟：真实调用智谱，默认跳过。
 * 跑法（PowerShell）：$env:RUN_REAL_LLM=1; pnpm test:e2e
 *
 * 不放进常规测试的原因：慢、要钱、要网络、结果会波动。
 */
describe.skipIf(process.env.RUN_REAL_LLM !== '1')(
  '真实模型调用（需 RUN_REAL_LLM=1）',
  () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('embed 返回配置里指定的维度', async () => {
      const llm = app.get(LlmService);
      const config = app.get(ConfigService);

      const vectors = await llm.embed(['这是一段测试文本']);

      expect(vectors).toHaveLength(1);
      expect(vectors[0]).toHaveLength(
        Number(config.get('LLM_EMBEDDING_DIMENSIONS')),
      );
      expect(typeof vectors[0][0]).toBe('number');
    });
  },
);
