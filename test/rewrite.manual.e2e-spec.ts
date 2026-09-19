import type { INestApplication } from '@nestjs/common';
import { REWRITE_QUERY_SYSTEM_PROMPT } from '../src/chat/constants/rewrite-query.prompt.js';
import { CHAT_ROLE_TYPE } from '../src/llm/constants/chat-role.constants.js';
import { LlmService } from '../src/llm/llm.service.js';
import type { ChatMessage } from '../src/llm/types/llm.type.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * 手动验证：用真实模型看「查询改写」这一步到底吐出了什么。
 *
 * 跑法（PowerShell）：
 *   $env:RUN_REAL_LLM=1
 *   pnpm test:e2e -- test/rewrite.manual.e2e-spec.ts
 *
 * 为什么必须手动跑：
 *   自动化测试里 LlmService 是假的 —— 那只能验证「拿到改写结果之后怎么处理」，
 *   **验证不了「模型会不会按要求改写」**。fake 的行为是我们自己写死的，测它等于自问自答。
 *   prompt 的质量只能靠真实输出来看。
 *
 * 为什么这步值得单独验：
 *   改写是整个链路的第一环。它错了，检索跟着错，最后答案也跟着错 ——
 *   而且错得很隐蔽（检索可能"命中"，但命中的是无关内容）。
 *
 * 输出怎么读：
 *   重点看标了【关键】的那几条 —— 它们验的是
 *   「多轮之后的闲聊，会不会被强行塞进上文话题」。
 *   一旦塞进去，那个 query 会带着话题词去检索，从而**误命中**，
 *   绕过「检索为空」的兜底，让模型拿着无关资料硬答。
 */
const enabled = process.env.RUN_REAL_LLM === '1';

interface Case {
  name: string;
  /** 关键用例：多轮之后的闲聊/寒暄，绝不该带上文话题 */
  critical?: boolean;
  history: { role: 'user' | 'assistant'; content: string }[];
  input: string;
  /** 给人看的期望描述 */
  expectation: string;
  /** 达标判断：只检查「改写结果会不会把检索带偏」这件事 */
  pass: (output: string, input: string) => boolean;
}

/** 上文里出现过的词 —— 闲聊用例的改写结果里绝不该出现它们 */
const TOPIC_WORDS = ['P0', '故障', 'SLA', '响应时限'];

/** 下面这些用例共用同一段「上文」，模拟用户在聊 P0 故障 */
const P0_HISTORY = [
  { role: 'user' as const, content: 'P0 故障是怎么定义的？' },
  {
    role: 'assistant' as const,
    content: 'P0 指核心业务完全不可用，是最高级别的故障。',
  },
  { role: 'user' as const, content: '那响应时限呢？' },
  {
    role: 'assistant' as const,
    content: 'P0 故障须在 15 分钟内响应，4 小时内给出解决方案。',
  },
];

const CASES: Case[] = [
  {
    name: '指代消解：多轮后追问「它」',
    history: P0_HISTORY,
    input: '那它的响应时限是多少？',
    expectation: '把「它」换成具体名词，输出类似「P0 故障的响应时限是多少？」',
    pass: (out) => out.includes('P0') || out.includes('故障'),
  },
  {
    name: '省略补全：多轮后只说「北京呢？」',
    history: [
      { role: 'user', content: '出差住宿费的标准是什么？' },
      { role: 'assistant', content: '按城市级别分档，一线城市上限更高。' },
    ],
    input: '北京呢？',
    expectation: '补全成「在北京出差的住宿标准是什么？」之类',
    pass: (out) => out.includes('北京') && out.length > '北京呢？'.length,
  },
  {
    name: '本就完整：不该被改',
    history: [],
    input: '如何申请年假？',
    expectation: '原样输出',
    pass: (out) => out.includes('年假'),
  },

  // ---------------- 关键：多轮之后的闲聊 ----------------

  {
    name: '多轮后说「在吗」',
    critical: true,
    history: P0_HISTORY,
    input: '在吗',
    expectation: '原样输出，绝不能把「P0 / 故障」硬塞进来',
    pass: (out) => !TOPIC_WORDS.some((w) => out.includes(w)),
  },
  {
    name: '多轮后道谢',
    critical: true,
    history: P0_HISTORY,
    input: '谢谢',
    expectation: '原样输出或类似的寒暄，不带上文话题',
    pass: (out) => !TOPIC_WORDS.some((w) => out.includes(w)),
  },
  {
    name: '多轮后扯闲话',
    critical: true,
    history: P0_HISTORY,
    input: '讲个笑话吧',
    expectation: '不要为了「像查询」而硬补全，不带上文话题',
    pass: (out) => !TOPIC_WORDS.some((w) => out.includes(w)),
  },
  {
    name: '多轮后问身份',
    critical: true,
    history: P0_HISTORY,
    input: '你是谁？',
    expectation: '不带上文话题',
    pass: (out) => !TOPIC_WORDS.some((w) => out.includes(w)),
  },
  {
    name: '多轮后附和',
    critical: true,
    history: P0_HISTORY,
    input: '好的',
    expectation: '不带上文话题',
    pass: (out) => !TOPIC_WORDS.some((w) => out.includes(w)),
  },
];

describe.skipIf(!enabled)('查询改写 prompt 验证（需 RUN_REAL_LLM=1）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    '逐条打印真实改写结果',
    async () => {
      const llm = app.get(LlmService);
      const failed: { index: number; name: string; output: string }[] = [];

      for (let i = 0; i < CASES.length; i++) {
        const testCase = CASES[i];

        const history: ChatMessage[] = testCase.history.map((m) => ({
          role:
            m.role === 'assistant'
              ? CHAT_ROLE_TYPE.ASSISTANT
              : CHAT_ROLE_TYPE.USER,
          content: m.content,
        }));

        // 调用形状和 ChatService.rewriteQuery 保持一致：
        // 同一条 system prompt、同样的 temperature: 0
        const raw = await llm.chat(
          [
            {
              role: CHAT_ROLE_TYPE.SYSTEM,
              content: REWRITE_QUERY_SYSTEM_PROMPT,
            },
            ...history,
            { role: CHAT_ROLE_TYPE.USER, content: testCase.input },
          ],
          { temperature: 0 },
        );

        // 这里只 trim。正式代码里还有去引号/去前缀的清洗，
        // 但那些只影响首尾字符，不影响下面的判断。
        const output = raw.trim();
        const ok = testCase.pass(output, testCase.input);

        console.log(
          `\n${'─'.repeat(70)}\n[${i + 1}/${CASES.length}] ` +
            `${testCase.critical ? '【关键】' : ''}${testCase.name}`,
        );
        if (history.length) {
          console.log(`  上文：${history.map((m) => m.content).join(' → ')}`);
        }
        console.log(`  输入：${testCase.input}`);
        console.log(`  输出：${output}`);
        console.log(`  期望：${testCase.expectation}`);
        console.log(`  结果：${ok ? '✓ 通过' : '✗ 未通过'}`);

        if (!ok) {
          failed.push({ index: i + 1, name: testCase.name, output });
        }
      }

      const passed = CASES.length - failed.length;
      console.log(`\n${'='.repeat(70)}`);
      console.log(`汇总：${passed}/${CASES.length} 通过`);

      if (failed.length) {
        console.log('\n未通过的用例：');
        for (const item of failed) {
          console.log(`  [${item.index}] ${item.name}`);
          console.log(`      输出：${item.output}`);
        }
        console.log(
          '\n⚠️ 若「关键」用例失败，说明改写会把闲聊带偏 —— 那类 query 会因为' +
            '带上话题词而误命中检索，绕过「检索为空」的兜底。',
        );
      }

      // 不对模型行为做硬断言（会随版本波动），这里只保证确实跑完了
      expect(passed).toBeGreaterThanOrEqual(0);
    },
    180_000,
  );
});
