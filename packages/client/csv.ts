export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === 'string' && /^\s*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
