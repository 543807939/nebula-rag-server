import { chunkText, type ChunkOptions } from './text-chunker.js';

/**
 * 包一层：这样测试里既能写 chunk('x') 也能写 chunk('x', { size: 10 })
 */
const chunk = (text: string, options: ChunkOptions = {}) =>
  chunkText(text, options);

describe('chunkText', () => {
  // ---------------- 边界输入 ----------------

  it('空字符串返回空数组', () => {
    expect(chunk('')).toEqual([]);
  });

  it('纯空白返回空数组', () => {
    expect(chunk('   \n\n  \t \n ')).toEqual([]);
  });

  it('短文本只产出一块，内容与原文完全一致', () => {
    const text = '这是一段很短的文本。';
    expect(chunk(text)).toEqual([text]);
  });

  it('CRLF 换行也能正确分段', () => {
    const chunks = chunk('第一段\r\n\r\n第二段');
    expect(chunks).toHaveLength(1);
    // 段落之间统一用 \n 连接，\r 被 trim 掉
    expect(chunks[0]).toBe('第一段\n第二段');
  });

  // ---------------- 段落合并 ----------------

  it('多个短段落会被合并进同一块', () => {
    const chunks = chunk('第一段\n\n第二段\n\n第三段');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('第一段\n第二段\n第三段');
  });

  it('恰好等于 size 时不切分', () => {
    const text = 'a'.repeat(500);
    expect(chunk(text)).toHaveLength(1);
  });

  it('段落合并后的每一块都不超过 size', () => {
    // 40 个短段落，必然会分成多块
    const text = Array.from(
      { length: 40 },
      (_, i) => `第${i}段：${'x'.repeat(30)}`,
    ).join('\n\n');

    const chunks = chunk(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
    }
  });

  // ---------------- 超长段落硬切 ----------------

  it('单段超过 size 会被硬切，且每块不超过 size', () => {
    const chunks = chunk('a'.repeat(501), { size: 500, overlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
    }
  });

  it('硬切后的相邻块确实有 overlap', () => {
    // 用可区分的文本，避免全 'a' 导致的"怎么切都相等"
    const paragraph = Array.from({ length: 1200 }, (_, i) =>
      String(i % 10),
    ).join('');

    const chunks = chunk(paragraph, { size: 500, overlap: 50 });

    // 第二块的前 50 字，应该就是第一块的后 50 字
    expect(chunks[1].slice(0, 50)).toBe(chunks[0].slice(-50));
  });

  it('硬切不会丢字符（把 overlap 去掉后能还原原文）', () => {
    const paragraph = Array.from({ length: 1200 }, (_, i) =>
      String(i % 10),
    ).join('');

    const size = 500;
    const overlap = 50;
    const chunks = chunk(paragraph, { size, overlap });

    // 第一块整块保留；之后每一块都去掉开头的 overlap 字，拼起来必须等于原文
    const reconstructed = chunks
      .map((c, i) => (i === 0 ? c : c.slice(overlap)))
      .join('');

    expect(reconstructed).toBe(paragraph);
  });

  it('自定义 size / overlap 同样不丢字符', () => {
    const paragraph = 'abcdefghij'.repeat(20); // 200 字
    const size = 50;
    const overlap = 10;

    const chunks = chunk(paragraph, { size, overlap });

    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(size);
    }
    const reconstructed = chunks
      .map((c, i) => (i === 0 ? c : c.slice(overlap)))
      .join('');
    expect(reconstructed).toBe(paragraph);
  });

  // ---------------- 一个刻意的设计：段落边界不重叠 ----------------

  it('段落边界之间不重叠（段落本身就是语义边界）', () => {
    const p1 = 'a'.repeat(300);
    const p2 = 'b'.repeat(300);

    const chunks = chunk(`${p1}\n\n${p2}`, { size: 500 });

    // 两块刚好是两个段落本身，没有互相回带
    // 如果哪天改成"所有相邻块都重叠"，这条会红 —— 提醒你这是一个有意的选择
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  // ---------------- 混排 ----------------

  it('普通段落与超长段落混排时不丢内容', () => {
    const text = ['开头段落', 'x'.repeat(800), '结尾段落'].join('\n\n');
    const chunks = chunk(text, { size: 500, overlap: 50 });
    const joined = chunks.join('\n');

    expect(joined).toContain('开头段落');
    expect(joined).toContain('结尾段落');
    expect(joined).toContain('x'.repeat(500));
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
    }
  });

  // ---------------- 防御性 ----------------

  it('overlap 大于等于 size 时不会死循环', () => {
    // 这个配置本身是错的，但函数必须能返回，不能把进程卡死
    const chunks = chunk('a'.repeat(1200), { size: 100, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(0);
  });
});
