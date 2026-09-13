import { redact } from './redact.util.js';

// 安全的序列化对象，防止无限递归 最多返回maxLength长度
export function safeStringify(value: unknown, maxLength: number = 500) {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'string' && Object.keys(value).length === 0) {
    return '-';
  }
  try {
    const json = JSON.stringify(redact(value));
    if (json === undefined) {
      return '-';
    }
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch (error) {
    console.error(error);
    return '[unserializable]';
  }
}
