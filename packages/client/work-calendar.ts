import type { Task } from '../contracts/model.ts';
import { calendarDay } from './task-time.ts';

/** Read-only projection: actual completion day and recorded work, never scheduled duration. */
export function projectWorkCalendar(tasks: readonly Task[], date: string, zone: string) {
  const completed = tasks.filter(task => task.status === 'done');
  const rows = completed
    .filter(task => calendarDay(task.completedAt, zone) === date)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.id.localeCompare(b.id));
  const unknown = completed
    .filter(task => !calendarDay(task.completedAt, zone))
    .sort((a, b) => a.id.localeCompare(b.id));
  const recorded = rows.filter(task => task.actualMinutes != null);
  const minutes = recorded.reduce((sum, task) => sum + task.actualMinutes!, 0);
  return { rows, unknown, recorded, minutes };
}
