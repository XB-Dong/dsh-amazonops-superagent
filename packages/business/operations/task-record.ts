import { Store } from '../core/store.ts';
import type { Task } from './task-types.ts';
import { taskTimeZone } from './task-time.ts';

export function createTaskRecord(store: Store, scope: string, input: {
  title: string; timeZone: string; checklist: string[]; sources: string[];
  confirmed?: boolean; schedule?: { startAt?: string; endAt?: string; dueAt?: string };
}): Task {
  taskTimeZone(input.timeZone);
  if (!input.title.trim() || input.title.length > 200 || !input.checklist.length ||
      input.checklist.length > 30 || input.checklist.some(text => !text.trim() || text.length > 300))
    throw new Error('INVALID_TASK');
  for (const id of input.sources) store.get(scope, id);
  return store.create(scope, 'task', {
    title: input.title.trim(), timeZone: input.timeZone, ...input.schedule,
    checklist: [...input.checklist], checked: input.checklist.map(() => false),
    status: input.confirmed ? 'open' : 'draft', confirmedSuccess: false,
    sources: [...input.sources],
  }) as Task;
}
