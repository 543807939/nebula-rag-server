const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apikey',
  'authorization',
];

// 剥离对象敏感字段
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      return SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))
        ? [key, '******']
        : [key, redact(v)];
    }),
  );
}
