import { calendarDay } from './task-time.ts';

export type CreatedTask = { id: string; createdAt?: string };
export type TaskDateGroup<T> = { date: string | null; tasks: T[] };

function creationInstant(value: string | undefined): number | undefined {
  if (typeof value !== 'string') return;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return;
  const date = Date.parse(`${match[1]}T00:00:00Z`);
  const instant = Date.parse(value);
  if (
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== match[1] ||
    !Number.isFinite(instant)
  )
    return;
  return instant;
}

export function groupTasksByCreatedDate<T extends CreatedTask>(
  tasks: readonly T[],
  timeZone: string,
): TaskDateGroup<T>[] {
  const dates = new Map<string | null, { task: T; instant: number | undefined }[]>();
  for (const task of tasks) {
    const instant = creationInstant(task.createdAt);
    const date = instant === undefined ? null : calendarDay(task.createdAt, timeZone)!;
    const group = dates.get(date) ?? [];
    group.push({ task, instant });
    dates.set(date, group);
  }
  return [...dates.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a > b ? -1 : 1))
    .map(([date, rows]) => ({
      date,
      tasks: rows
        .sort((a, b) => {
          if (a.instant !== b.instant) return b.instant! - a.instant!;
          return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
        })
        .map(({ task }) => task),
    }));
}
