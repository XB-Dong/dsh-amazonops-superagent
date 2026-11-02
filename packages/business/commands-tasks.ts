import type { CommandMap, CommandContext, Input } from './command-context.ts';
import { safeText } from './core/validation.ts';
import { TaskCopies } from './operations/task-copy.ts';
import type { TaskChanges } from './operations/tasks.ts';

function createTask(ctx: CommandContext, scope: string, body: Input) {
  const title = safeText(body.title, 200);
  const checklist = Array.isArray(body.checklist) ? body.checklist.map(value => safeText(value, 300)) : [];
  const source = ctx.capture.enqueue(scope, title, safeText(body.requestId, 100));
  return ctx.tasks.create(scope, source.id, {
    title, checklist, timeZone: String(body.timeZone ?? ''), sourceId: source.id, confirmed: true,
    dueAt: body.dueAt ? String(body.dueAt) : undefined,
    startAt: body.startAt === undefined ? undefined : safeText(body.startAt, 40),
    endAt: body.endAt === undefined ? undefined : safeText(body.endAt, 40),
  });
}
function updateTask(ctx: CommandContext, scope: string, body: Input) {
  const changes: TaskChanges = {};
  if (body.title !== undefined) changes.title = safeText(body.title, 200);
  if (body.timeZone !== undefined) changes.timeZone = safeText(body.timeZone, 100);
  if (body.checklist !== undefined) {
    if (!Array.isArray(body.checklist)) throw new Error('INVALID_CHECKLIST');
    changes.checklist = body.checklist.map(value => safeText(value, 300));
  }
  for (const field of ['dueAt', 'startAt', 'endAt'] as const)
    if (body[field] !== undefined) changes[field] = body[field] === null ? null : safeText(body[field], 40);
  if (body.status !== undefined) changes.status = safeText(body.status, 30);
  if (body.checked !== undefined) {
    if (!Array.isArray(body.checked)) throw new Error('INVALID_CHECKLIST');
    changes.checked = body.checked as boolean[];
  }
  if (body.confirmedSuccess !== undefined) {
    if (typeof body.confirmedSuccess !== 'boolean') throw new Error('INVALID_TASK');
    changes.confirmedSuccess = body.confirmedSuccess;
  }
  if (body.actualMinutes !== undefined) changes.actualMinutes = body.actualMinutes as number | null;
  return ctx.tasks.update(scope, safeText(body.id, 100), Number(body.revision), changes);
}
export const taskCommands: CommandMap = {
  task: createTask,
  'task-update': updateTask,
  'task-copy': (ctx, scope, body) => new TaskCopies(ctx.store).copy(scope, body),
};
