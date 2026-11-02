import { Store, now } from '../core/store.ts';
import type { Task } from './task-types.ts';
import { createTaskRecord } from './task-record.ts';
import { taskSchedule, type TaskSchedule } from './task-time.ts';

export type TaskInput = {
  title: string;
  timeZone: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  checklist: string[];
  sourceId: string;
  confirmed?: boolean;
};
export type TaskChanges = TaskSchedule & {
  title?: string;
  checklist?: string[];
  status?: string;
  checked?: boolean[];
  confirmedSuccess?: boolean;
  actualMinutes?: number | null;
};

function objectFields(value: unknown, allowed: string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error('INVALID_TASK');
}

function taskText(title: unknown, checklist: unknown): void {
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 200 ||
    !Array.isArray(checklist) ||
    !checklist.length ||
    checklist.length > 30 ||
    checklist.some((text) => typeof text !== 'string' || !text.trim() || text.length > 300)
  )
    throw new Error('INVALID_TASK');
}

export class Tasks {
  store: Store;
  constructor(store: Store, _legacyConsumer?: unknown) { this.store = store; }
  create(scope: string, key: string, input: TaskInput): Task {
    objectFields(input, [
      'title',
      'timeZone',
      'startAt',
      'endAt',
      'dueAt',
      'checklist',
      'sourceId',
      'confirmed',
    ]);
    taskText(input.title, input.checklist);
    if (
      typeof input.sourceId !== 'string' ||
      !input.sourceId ||
      (input.confirmed !== undefined && typeof input.confirmed !== 'boolean')
    )
      throw new Error('INVALID_TASK');
    const schedule = taskSchedule(input);
    this.store.get(scope, input.sourceId);
    return this.store.once(
      scope,
      `task:${key}`,
      () =>
        createTaskRecord(this.store, scope, {
          title: input.title, timeZone: input.timeZone, schedule,
          checklist: input.checklist, confirmed: input.confirmed, sources: [input.sourceId],
        }),
    );
  }
  update(scope: string, id: string, revision: number, changes: TaskChanges): Task {
    objectFields(changes, [
      'title',
      'checklist',
      'timeZone',
      'startAt',
      'endAt',
      'dueAt',
      'status',
      'checked',
      'confirmedSuccess',
      'actualMinutes',
    ]);
    const result = this.store.transaction(() => {
      const task = this.store.get<Task>(scope, id);
      if (task.kind !== 'task') throw new Error('INVALID_TASK');
      if (task.revision !== revision) throw new Error('REVISION_CONFLICT');
      if (
        (changes.status !== undefined && typeof changes.status !== 'string') ||
        (changes.confirmedSuccess !== undefined && typeof changes.confirmedSuccess !== 'boolean')
      )
        throw new Error('INVALID_TASK');
      if (
        changes.actualMinutes !== undefined &&
        changes.actualMinutes !== null &&
        (!Number.isInteger(changes.actualMinutes) ||
          changes.actualMinutes < 0 ||
          changes.actualMinutes > 1440)
      )
        throw new Error('INVALID_ACTUAL_MINUTES');
      const structural = ['title', 'checklist', 'timeZone', 'startAt', 'endAt', 'dueAt'] as const;
      const locked = task.status === 'done' || task.status === 'cancelled';
      if (
        locked &&
        (structural.some((key) => changes[key] !== undefined) ||
          (changes.checked !== undefined &&
            JSON.stringify(changes.checked) !== JSON.stringify(task.checked)) ||
          (changes.confirmedSuccess !== undefined &&
            changes.confirmedSuccess !== task.confirmedSuccess) ||
          (task.status === 'cancelled' && changes.actualMinutes !== undefined))
      )
        throw new Error('TASK_NOT_EDITABLE');
      const title = changes.title === undefined ? task.title : changes.title;
      const checklist = changes.checklist === undefined ? task.checklist : changes.checklist;
      taskText(title, checklist);
      const schedule = structural.some(
        (key) => key !== 'title' && key !== 'checklist' && changes[key] !== undefined,
      )
        ? taskSchedule(changes, task)
        : {};
      const transitions: Record<string, string[]> = {
        draft: ['open', 'cancelled'],
        open: ['in_progress', 'done', 'cancelled'],
        in_progress: ['done', 'cancelled'],
        done: [],
        cancelled: [],
      };
      if (
        changes.status !== undefined &&
        changes.status !== task.status &&
        !transitions[task.status]?.includes(changes.status)
      )
        throw new Error('INVALID_TASK_TRANSITION');
      let checked = changes.checked === undefined ? [...task.checked] : changes.checked;
      if (
        !Array.isArray(checked) ||
        (changes.checklist === undefined && checked.length !== checklist.length) ||
        (changes.checked !== undefined && checked.length !== checklist.length) ||
        checked.some((value) => typeof value !== 'boolean')
      )
        throw new Error('INVALID_CHECKLIST');
      if (changes.checklist !== undefined)
        checked = checklist.map((text, index) =>
          text === task.checklist[index]
            ? (changes.checked?.[index] ?? task.checked[index] ?? false)
            : false,
        );
      const status = changes.status ?? task.status;
      if (status === 'done' && !checked.every(Boolean)) throw new Error('CHECKLIST_INCOMPLETE');
      if (changes.confirmedSuccess && status !== 'done')
        throw new Error('WORKFLOW_NOT_CONFIRMED_SUCCESS');
      const next = this.store.update(
        task,
        {
          title: title.trim(),
          checklist: [...checklist],
          ...schedule,
          status,
          checked: [...checked],
          confirmedSuccess: changes.confirmedSuccess ?? task.confirmedSuccess,
          ...(changes.actualMinutes !== undefined ? { actualMinutes: changes.actualMinutes } : {}),
          ...(status === 'done' && task.status !== 'done' ? { completedAt: now() } : {}),
        },
        revision,
      );
      if (!task.confirmedSuccess && next.confirmedSuccess)
        this.store.create(scope, 'job', {
          type: 'workflow',
          taskId: id,
          status: 'pending',
          attempts: 0,
        });
      return next;
    });
    return result;
  }
}
