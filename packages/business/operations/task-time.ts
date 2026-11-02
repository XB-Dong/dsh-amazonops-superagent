import type { Task } from './task-types.ts';
import { calendarDate, zonedInstant } from './time.ts';

export type TaskSchedule = {
  timeZone?: string;
  startAt?: string | null;
  endAt?: string | null;
  dueAt?: string | null;
};

export function taskTimeZone(value: unknown): asserts value is string {
  if (value === '') throw new Error('TIME_ZONE_REQUIRED');
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value))
    throw new Error('INVALID_TIME_ZONE');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new Error('INVALID_TIME_ZONE');
  }
}

function taskInstant(value: unknown, timeZone: string): number {
  if (typeof value !== 'string') throw new Error('INVALID_TIME');
  const parts =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) throw new Error('EXPLICIT_OFFSET_REQUIRED');
  try {
    calendarDate(value.slice(0, 10));
  } catch {
    throw new Error('INVALID_TIME');
  }
  // Normalize only for validation: old minute precision remains unchanged in storage.
  zonedInstant(`${parts[1]}:${parts[2] ?? '00'}${parts[4]}`, timeZone);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('INVALID_TIME');
  return instant;
}

export function taskSchedule(changes: TaskSchedule, previous?: Task): Partial<Task> {
  const timeZone = changes.timeZone === undefined ? previous?.timeZone : changes.timeZone;
  taskTimeZone(timeZone);
  const supplied = (key: keyof TaskSchedule) => changes[key] !== undefined;
  if (previous && timeZone !== previous.timeZone) {
    if (
      (previous.startAt && !supplied('startAt')) ||
      (previous.endAt && !supplied('endAt')) ||
      (previous.dueAt && !supplied('dueAt') && !supplied('endAt'))
    )
      throw new Error('TIME_ZONE_SCHEDULE_REQUIRED');
  }
  const patch: Partial<Task> = {};
  if (changes.timeZone !== undefined) patch.timeZone = timeZone;
  for (const key of ['startAt', 'endAt', 'dueAt'] as const) {
    const value = changes[key];
    if (value === undefined) continue;
    if (value !== null) taskInstant(value, timeZone);
    patch[key] = value ?? undefined;
  }
  if (supplied('endAt')) {
    if (supplied('dueAt') && (changes.dueAt ?? undefined) !== patch.endAt)
      throw new Error('TASK_END_DUE_MISMATCH');
    patch.dueAt = patch.endAt;
  } else if (supplied('dueAt') && previous?.endAt && patch.dueAt !== previous.endAt) {
    throw new Error('TASK_END_DUE_MISMATCH');
  }
  if (supplied('startAt') || supplied('endAt') || supplied('dueAt')) {
    const start = supplied('startAt') ? patch.startAt : previous?.startAt;
    const end = supplied('endAt')
      ? patch.endAt
      : (previous?.endAt ?? (supplied('dueAt') ? patch.dueAt : previous?.dueAt));
    if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error('TASK_TIME_ORDER');
  }
  return patch;
}
