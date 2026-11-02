import type { CommandContext, Input } from './command-context.ts';
import { TaskCopies } from './operations/task-copy.ts';
import { readOperations } from './operations/context.ts';
import { safeText } from './core/validation.ts';
import type { Task } from './operations/task-types.ts';

const writes = new Set(['copy_task','prepare_task','capture_feedback']);
export function businessTool(ctx: CommandContext, scope: string, sourceId: string | undefined,
  action: string, body: Input, operationId?: string): unknown {
  if (writes.has(action)) {
    if (!sourceId) throw new Error('SOURCE_REQUIRED');
    const source = ctx.store.get(scope, sourceId);
    if (source.kind !== 'source') throw new Error('SOURCE_REQUIRED');
    if (!operationId) throw new Error('OPERATION_REQUIRED');
    safeText(operationId, 100);
    return ctx.store.command(scope, `tool:${operationId}`, { sourceId, action, body }, () => {
      const result = executeTool(ctx, scope, sourceId, action, body, operationId);
      ctx.store.appendEvent(scope, `tool:${action}`, result && typeof result === 'object' ? result : undefined);
      return result;
    });
  }
  return executeTool(ctx, scope, sourceId, action, body, operationId);
}
function executeTool(ctx: CommandContext, scope: string, sourceId: string | undefined,
  action: string, body: Input, operationId?: string): unknown {
    if (action === 'get_task') return new TaskCopies(ctx.store).detail(scope, body);
    if (action === 'copy_task') {
      if (!sourceId) throw new Error('SOURCE_REQUIRED');
      const task = new TaskCopies(ctx.store).copy(scope, body, sourceId, operationId);
      return {
        id: task.id,
        revision: task.revision,
        title: task.title,
        status: task.status,
        timeZone: task.timeZone,
        totalItems: task.checklist.length,
      };
    }
    if (action === 'read_operations') return readOperations(ctx.store, scope, body);
    if (action === 'find_skills') {
      const query = safeText(body.query, 100).toLowerCase();
      const offset = body.offset === undefined ? 0 : Number(body.offset);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_OFFSET');
      const rows = ctx.learning
        .activeSkills(scope)
        .filter((s) => `${s.name} ${s.description} ${s.content}`.toLowerCase().includes(query));
      return {
        skills: rows
          .slice(offset, offset + 6)
          .map(({ id, name, description }) => ({ id, name, description })),
        total: rows.length,
        nextOffset: offset + 6 < rows.length ? offset + 6 : null,
      };
    }
    if (action === 'skills')
      return ctx.learning
        .activeSkills(scope)
        .slice(0, 6)
        .map(({ id, name, description }) => ({ id, name, description }));
    if (action === 'skill')
      return (
        ctx.learning
          .activeSkills(scope)
          .find((row) => row.id === body.id && Buffer.byteLength(row.content) <= 6000) ?? null
      );
    if (action === 'list_tasks' || action === 'read_memory') {
      const offset = body.offset === undefined ? 0 : Number(body.offset);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_OFFSET');
      if (action === 'list_tasks') {
        const rows = ctx.store.list<Task>(scope, 'task');
        const tasks = rows
          .slice(offset, offset + 8)
          .map(({ id, title, status, timeZone, dueAt }) => ({
            id,
            title: title.slice(0, 100),
            status,
            timeZone,
            dueAt,
          }));
        return {
          tasks,
          total: rows.length,
          nextOffset: offset + 8 < rows.length ? offset + 8 : null,
        };
      }
      const rows = ctx.learning.context(scope).facts;
      const facts = rows
        .slice(offset, offset + 4)
        .map(({ id, key, value, sources }) => ({ id, key, value, sources: sources.slice(0, 2) }));
      return {
        facts,
        total: rows.length,
        nextOffset: offset + 4 < rows.length ? offset + 4 : null,
      };
    }
    if (action === 'draft_checklist') {
      const skill = ctx.learning.activeSkills(scope).find((row) => row.id === body.skillId);
      if (!skill || skill.risk !== 'L0') throw new Error('SKILL_REVOKED_OR_UNAVAILABLE');
      return {
        skillId: skill.id,
        version: skill.revision,
        checklist: skill.steps.map((text) => ({ text, checked: false })),
        status: 'draft',
      };
    }
    if (!sourceId) throw new Error('SOURCE_REQUIRED');
    if (action === 'prepare_task') {
      const title = safeText(body.title, 200);
      const checklist = Array.isArray(body.checklist)
        ? body.checklist.map((value) => safeText(value, 300))
        : [];
      return ctx.tasks.create(scope, `model:${operationId}`, {
        title,
        checklist,
        timeZone: String(body.timeZone ?? ''),
        dueAt: body.dueAt ? String(body.dueAt) : undefined,
        sourceId,
      });
    }
    if (action === 'capture_feedback')
      return (
        ctx.learning.feedback(scope, sourceId, {
          text: safeText(body.text),
          expected: typeof body.expected === 'string' ? safeText(body.expected, 1000) : undefined,
          actual: typeof body.actual === 'string' ? safeText(body.actual, 1000) : undefined,
        }) ?? { status: 'learning_paused' }
      );
    throw new Error('TOOL_FORBIDDEN');
}
