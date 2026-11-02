export function safeText(value: unknown, maximum = 12000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error('INVALID_TEXT');
  if (
    /(?:\bsk-[a-z\d_-]{20,}|\b(?:ghp_|github_pat_)[a-z\d_]{20,}|-----BEGIN.*PRIVATE KEY|(?:password|api[_ -]?key|cookie)\s*[:=]\s*\S{6,})/i.test(
      value,
    )
  )
    throw new Error('SENSITIVE_INPUT_BLOCKED');
  return value.trim();
}
export function quantity(value: number, maximum = 1e9): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error('INVALID_QUANTITY');
  return value;
}
