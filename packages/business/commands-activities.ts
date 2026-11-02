import type { CommandMap } from './command-context.ts';
import { safeText } from './core/validation.ts';
import type { Base } from './core/store.ts';
import type { Activity } from './operations/activities.ts';

export const activityCommands: CommandMap = {
  activity: (ctx, scope, body) => ctx.activities.create(scope, safeText(body.requestId, 100), {
    title: safeText(body.title, 200), store: safeText(body.store, 100), listing: safeText(body.listing, 100),
    timeZone: safeText(body.timeZone, 100), startAt: safeText(body.startAt, 40), endAt: safeText(body.endAt, 40),
    leadHours: Number(body.leadHours), offerNote: body.offerNote ? safeText(body.offerNote, 1000) : '',
  }),
  'activity-cancel': (ctx, scope, body) => ctx.activities.cancel(scope, safeText(body.id, 100), Number(body.revision)),
  'activity-observe': (ctx, scope, body) => {
    const row = ctx.store.get<Activity>(scope, safeText(body.id, 100));
    if (row.kind !== 'activity' || body.confirmed !== true ||
      !((row.status === 'planned' && body.status === 'active') || (row.status === 'active' && body.status === 'restored')))
      throw new Error('INVALID_ACTIVITY_STATE');
    return ctx.store.update(row, { status: String(body.status) }, Number(body.revision));
  },
  'reminder-read': (ctx, scope, body) => {
    const row = ctx.store.get<Base & { read: boolean }>(scope, safeText(body.id, 100));
    if (row.kind !== 'reminder') throw new Error('NOT_FOUND');
    return ctx.store.update(row, { read: true }, Number(body.revision));
  },
};
