export function zonedInstant(value: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error('EXPLICIT_OFFSET_REQUIRED');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('INVALID_TIME');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
  } catch {
    throw new Error('INVALID_TIME_ZONE');
  }
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const local = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  if (local !== value.slice(0, 19)) throw new Error('SITE_TIME_MISMATCH');
  return instant;
}
export function calendarDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('INVALID_DATE');
  return value;
}
