export interface ChunkOptions {
  /** 单块目标字数，默认 500 */
  size?: number;
  /** 相邻块的重叠字数，默认 50 */
  overlap?: number;
}
export function chunkText(text: string, options: ChunkOptions = {}) {
  const { size = 500, overlap = 50 } = options;
  // 先按照段落切割
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';
  // 遍历段落 尽可能凑够500字.
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      chunks.push(...splitLong(paragraph, size, overlap));
      continue;
    }
    if (buffer.length + paragraph.length <= size) {
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
    } else {
      if (buffer) {
        chunks.push(buffer);
        // 段落是天然语义边界，在这里切不会切断句子，所以不回带 overlap；
        // overlap 只在 splitLong 硬切段落中间时才需要
        buffer = paragraph;
      }
    }
  }
  if (buffer) {
    chunks.push(buffer);
  }
  return chunks;
}

function splitLong(paragraph: string, size: number, overlap: number): string[] {
  const results: string[] = [];

  let start = 0;
  while (start < paragraph.length) {
    results.push(paragraph.slice(start, start + size));
    start += size - overlap;
    if (size - overlap <= 0) {
      break;
    }
  }

  return results;
}
