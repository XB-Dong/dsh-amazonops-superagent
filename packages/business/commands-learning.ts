import type { CommandMap, CommandContext, Input } from './command-context.ts';
import { safeText } from './core/validation.ts';
import type { Feedback, Skill } from './learning/service.ts';
import { confirmChange, exportChanges, withdrawFeedback } from './learning/export.ts';

function captureFeedback(ctx: CommandContext, scope: string, body: Input) {
  const text = safeText(body.text);
  const source = ctx.capture.enqueue(scope, text, safeText(body.requestId, 100));
  return ctx.learning.feedback(scope, source.id, {
    text, page: typeof body.page === 'string' ? safeText(body.page, 100) : undefined,
    expected: typeof body.expected === 'string' && body.expected ? safeText(body.expected, 1000) : undefined,
    actual: typeof body.actual === 'string' && body.actual ? safeText(body.actual, 1000) : undefined,
  });
}
function updateFeedback(ctx: CommandContext, scope: string, body: Input) {
  if (body.status === 'withdrawn')
    return withdrawFeedback(ctx.store, scope, safeText(body.id, 100), Number(body.revision));
  const row = ctx.store.get<Feedback>(scope, safeText(body.id, 100));
  if (row.kind !== 'feedback' || !['captured','triaged','accepted','deferred','rejected','withdrawn'].includes(String(body.status)))
    throw new Error('INVALID_FEEDBACK_STATE');
  return ctx.store.update(row, { status: String(body.status) }, Number(body.revision));
}
function appendFeedback(ctx: CommandContext, scope: string, body: Input) {
  const id = safeText(body.id, 100), text = safeText(body.text, 1000), requestId = safeText(body.requestId, 100);
  return ctx.store.once(scope, `feedback-append:${requestId}`, () => {
    const feedback = ctx.store.get<Feedback>(scope, id);
    if (feedback.kind !== 'feedback' || feedback.status === 'withdrawn') throw new Error('INVALID_FEEDBACK');
    const source = ctx.store.source(scope, text);
    return ctx.store.update(feedback, {
      sources: [...feedback.sources, source.id],
      amendments: [...(feedback.amendments ?? []), { text, sourceId: source.id, createdAt: source.createdAt }],
    }, Number(body.revision));
  });
}
export const learningCommands: CommandMap = {
  feedback: captureFeedback,
  'feedback-update': updateFeedback,
  'feedback-append': appendFeedback,
  memory: (ctx, scope, body) => {
    const key = safeText(body.key, 80), value = safeText(body.value, 300);
    const source = ctx.capture.enqueue(scope, `${key}：${value}`, safeText(body.requestId, 100));
    const memory = ctx.learning.remember(scope, source.id, key, value, true);
    ctx.learning.compact(scope);
    return memory;
  },
  delete: (ctx, scope, body) => {
    const id = safeText(body.id, 100);
    ctx.learning.deleteSource(scope, id);
    return { deleted: id };
  },
  learning: (ctx, scope, body) => {
    ctx.learning.setEnabled(scope, body.enabled === true);
    return { enabled: ctx.learning.enabled(scope) };
  },
  compact: (ctx, scope, body) => ctx.learning.compact(scope, typeof body.revision === 'number' ? body.revision : undefined),
  'skill-revoke': (ctx, scope, body) => ctx.learning.revoke(scope, safeText(body.id, 100)),
  'skill-confirm': (ctx, scope, body) => {
    const skill = ctx.store.get<Skill>(scope, safeText(body.id, 100));
    if (skill.kind !== 'skill' || skill.status !== 'waiting_confirmation' || ctx.learning.validateDraft(skill.steps).length)
      throw new Error('SKILL_NOT_VALIDATED');
    return ctx.store.update(skill, { status: 'active' }, Number(body.revision));
  },
  'change-confirm': (ctx, scope, body) => confirmChange(ctx.store, scope, safeText(body.id, 100), safeText(body.requirementId, 50)),
  export: (ctx, scope) => exportChanges(ctx.store, scope, ctx.dataDir),
};
