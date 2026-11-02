import type { CommandMap } from './command-context.ts';
import { safeText } from './core/validation.ts';

export const noteCommands: CommandMap = {
  note: (ctx, scope, body) => ctx.notes.create(scope, safeText(body.requestId, 100), {
    title: safeText(body.title, 200), content: safeText(body.content, 10000),
  }),
  'note-update': (ctx, scope, body) => ctx.notes.update(scope, safeText(body.id, 100), Number(body.revision), {
    title: safeText(body.title, 200), content: safeText(body.content, 10000),
  }),
  'note-delete': (ctx, scope, body) => {
    const id = safeText(body.id, 100);
    ctx.notes.remove(scope, id, Number(body.revision));
    return { deleted: id };
  },
};
