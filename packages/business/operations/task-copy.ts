import { createTaskRecord } from './task-record.ts';
import { Store, digest, type Source } from '../core/store.ts';
import type { Task } from './task-types.ts';
import { taskTimeZone } from './task-time.ts';

function fields(body: Record<string, unknown>, allowed: string[]): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new Error('INVALID_TASK');
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw new Error('INVALID_TASK');
  return value;
}

export class TaskCopies {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  detail(scope: string, body: Record<string, unknown>) {
    fields(body, ['taskId', 'offset']);
    const offset = body.offset === undefined ? 0 : body.offset;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)
      throw new Error('INVALID_OFFSET');
    const row = this.store.get<Task>(scope, identifier(body.taskId));
    if (row.kind !== 'task') throw new Error('INVALID_TASK');
    const { id, revision, title, timeZone, createdAt, status, startAt, endAt, dueAt } = row;
    const result = {
      task: { id, revision, title, timeZone, createdAt, status, startAt, endAt, dueAt },
      checklist: row.checklist.slice(offset, offset + 4),
      checked: row.checked.slice(offset, offset + 4),
      totalItems: row.checklist.length,
      nextOffset: offset + 4 < row.checklist.length ? offset + 4 : null,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > 6000) throw new Error('TASK_DETAIL_TOO_LARGE');
    return result;
  }

  copy(scope: string, body: Record<string, unknown>, sourceId?: string, operationId?: string): Task {
    fields(
      body,
      sourceId
        ? ['taskId', 'revision', 'title', 'replaceFrom', 'replaceTo']
        : ['requestId', 'taskId', 'revision', 'title', 'replaceFrom', 'replaceTo'],
    );
    const taskId = identifier(body.taskId);
    if (
      typeof body.revision !== 'number' ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1
    )
      throw new Error('INVALID_TASK');
    if (
      body.title !== undefined &&
      (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200)
    )
      throw new Error('INVALID_TASK');
    if (
      (body.replaceFrom !== undefined || body.replaceTo !== undefined) &&
      [body.replaceFrom, body.replaceTo].some(
        (value) => typeof value !== 'string' || !value.trim() || value.length > 100,
      )
    )
      throw new Error('INVALID_TASK');
    const input = {
      taskId,
      revision: body.revision,
      title: body.title,
      replaceFrom: body.replaceFrom,
      replaceTo: body.replaceTo,
    };
    const fingerprint = digest(input);
    const key = operationId ? `operation:${identifier(operationId)}` : sourceId
      ? `model:${identifier(sourceId)}:${fingerprint}`
      : `ui:${identifier(body.requestId)}`;
    const result = this.store.once(scope, `task-copy:${key}`, () => {
      const original = this.store.get<Task>(scope, taskId);
      if (original.kind !== 'task') throw new Error('INVALID_TASK');
      if (original.revision !== input.revision) throw new Error('REVISION_CONFLICT');
      // Legacy data is not trusted: validate inherited fields before creating any copy records.
      taskTimeZone(original.timeZone);
      if (original.timeZone.length > 100) throw new Error('INVALID_TIME_ZONE');
      const replace = (text: string) =>
        input.replaceFrom === undefined
          ? text
          : text.split(input.replaceFrom as string).join(input.replaceTo as string);
      const title = replace((input.title as string | undefined) ?? original.title).trim();
      const checklist = original.checklist.map(replace);
      if (
        !title ||
        title.length > 200 ||
        !checklist.length ||
        checklist.length > 30 ||
        checklist.some((text) => !text.trim() || text.length > 300)
      )
        throw new Error('INVALID_TASK');
      // Source creation belongs to the same transaction: failed copies leave no jobs or orphan sources.
      const source = sourceId
        ? this.store.get<Source>(scope, sourceId)
        : this.store.source(scope, 'Task copy requested');
      if (source.kind !== 'source') throw new Error('SOURCE_REQUIRED');
      const task = createTaskRecord(this.store, scope, {
        title, checklist, timeZone: original.timeZone, sources: [original.id, source.id],
      });
      return { fingerprint, task };
    });
    if (result.fingerprint !== fingerprint) throw new Error('COPY_REQUEST_CONFLICT');
    return result.task;
  }
}
