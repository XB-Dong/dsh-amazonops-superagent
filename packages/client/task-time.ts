type Fields = { date: string; time: string };
const pad = (value: number) => String(value).padStart(2, '0');
function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error('请选择有效的时区。');
  }
}
function parts(format: Intl.DateTimeFormat, instant: number) {
  const values = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    second: values.second,
  };
}
export function localFields(instant: string | undefined, timeZone: string): Fields {
  if (!instant || !Number.isFinite(Date.parse(instant))) return { date: '', time: '' };
  const value = parts(formatter(timeZone), Date.parse(instant));
  return { date: value.date, time: value.time };
}
export function calendarDay(instant: string | undefined, timeZone: string): string | undefined {
  return localFields(instant, timeZone).date || undefined;
}
export function localTimeToInstant(date: string, time: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请填写完整有效的日期。');
  const [year, month, day] = date.split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, day);
  if (year < 1000 || new Date(midnight).toISOString().slice(0, 10) !== date)
    throw new Error('日期无效，请重新选择。');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效的时间。');
  const [hour, minute] = time.split(':').map(Number);
  const wall = midnight + (hour * 60 + minute) * 60_000;
  const format = formatter(timeZone);
  const offsets = new Set<number>();
  // Sample both sides of a clock change; candidates are verified against the complete wall time.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = wall + hours * 3_600_000;
    const local = parts(format, sample);
    const encoded = Date.parse(`${local.date}T${local.time}:${local.second}Z`);
    offsets.add((encoded - sample) / 60_000);
  }
  const candidates = [...offsets].filter((offset) => {
    const local = parts(format, wall - offset * 60_000);
    return local.date === date && local.time === time && local.second === '00';
  });
  if (!candidates.length) throw new Error('这个当地时间因夏令时调整而不存在，请重新选择其他时间。');
  if (candidates.length > 1)
    throw new Error('这个当地时间因夏令时调整会出现两次，请重新选择重叠时段之外的时间。');
  const offset = candidates[0];
  if (!Number.isInteger(offset)) throw new Error('这个历史时区时间不支持，请重新选择日期。');
  const absolute = Math.abs(offset);
  return `${date}T${time}:00${offset < 0 ? '-' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
export function timeOptions(old = ''): string[] {
  const options = Array.from(
    { length: 96 },
    (_, index) => `${pad(Math.floor(index / 4))}:${pad((index % 4) * 15)}`,
  );
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(old) && !options.includes(old)) options.push(old);
  return options.sort();
}
export function plannedLabel(task: {
  timeZone: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
}) {
  const label = (instant: string) =>
    new Date(instant).toLocaleString('zh-CN', { timeZone: task.timeZone, hour12: false });
  const start = task.startAt ? `开始 ${label(task.startAt)}` : '';
  const end = task.endAt ?? task.dueAt;
  return [start, end ? `结束 ${label(end)}` : ''].filter(Boolean).join('；') || '未设计划时间';
}

export function scheduleChanges(
  initial: { timeZone: string; startAt?: string; endAt?: string; dueAt?: string } | undefined,
  zone: string,
  start: Fields,
  end: Fields,
): { startAt?: string | null; endAt?: string | null } {
  const changes: { startAt?: string | null; endAt?: string | null } = {};
  const zoneChanged = !!initial && zone !== initial.timeZone;
  const collect = (name: 'startAt' | 'endAt', value: Fields, oldInstant?: string) => {
    const old = localFields(oldInstant, initial?.timeZone ?? zone);
    const changed = value.date !== old.date || value.time !== old.time;
    if (changed || (zoneChanged && !!oldInstant)) {
      changes[name] =
        !value.date && !value.time ? null : localTimeToInstant(value.date, value.time, zone);
    }
  };
  collect('startAt', start, initial?.startAt);
  collect('endAt', end, initial?.endAt ?? initial?.dueAt);
  const first = changes.startAt === undefined ? initial?.startAt : changes.startAt;
  const last = changes.endAt === undefined ? (initial?.endAt ?? initial?.dueAt) : changes.endAt;
  if (first && last && Date.parse(first) >= Date.parse(last))
    throw new Error('计划结束时间需要晚于开始时间。');
  return changes;
}
