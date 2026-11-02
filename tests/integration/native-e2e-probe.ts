/** Read-only test observer. No Engine commands, model responses or tool registrations. */
import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Runtime } from '../../vendor/superagent/src/extension.ts';
import type { SessionId } from '@deepseek-ai/dsh-session';

export const inject = ['sessionPersistence', 'webServer'];
export function apply(ctx: Context, config: { evidence: string }): void {
  ctx.logger.exporter({ export(message) {
    appendFileSync(join(config.evidence, 'native-logs.jsonl'), JSON.stringify({ name: message.name, type: message.type,
      args: message.args.map(value => value instanceof Error ? value.stack : String(value)) }) + '\n');
  } });
  // Windows process.kill cannot deliver a catchable SIGTERM. Relay only the test's
  // private IPC message into the official launcher's already-installed signal handler.
  const shutdown = (message: unknown) => { if (message === 'native-e2e-graceful-stop') process.emit('SIGTERM'); };
  process.on('message', shutdown);
  ctx.effect(() => () => { process.off('message', shutdown); });
  ctx.on('session/event', (session, event) => {
    appendFileSync(join(config.evidence, 'session-events.jsonl'), JSON.stringify({ sessionId: session.id, event }) + '\n');
  }, { global: true });
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/native-e2e/inspection', handler: async (req, res) => {
    try {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId');
      if (!id) throw new Error('SESSION_REQUIRED');
      await ctx.sessionPersistence.flush();
      await using handle = await ctx.sessionPersistence.open(id as SessionId, 'read');
      const { events } = await handle.read(0);
      res.setHeader('content-type', 'application/json');res.end(JSON.stringify({ header: handle.header, events }));
    } catch { res.writeHead(404, { 'content-type': 'application/json' });res.end('{"error":"SESSION_NOT_READABLE"}'); }
  } }));
  let generation = 0;
  ctx.inject(['orchestrator'], async child => {
    const runtime = child.get('orchestrator') as unknown as Runtime;
    await runtime.ready;
    generation++;
    const instance = randomUUID();
    const snapshot = () => {
      try {
        const triggers = runtime.store.read.triggers({ source: 'amazonops' }, 0, 500).items;
        // Readers run in another process. Publish complete JSON in one rename,
        // never expose writeFileSync's truncate/write window as native corruption.
        const snapshotPath = join(config.evidence, 'native-state.json');
        writeFileSync(`${snapshotPath}.next`, JSON.stringify({
          engine: runtime.engine.constructor.name, store: runtime.store.constructor.name,
          executor: runtime.executor.constructor.name, masterId: runtime.masterId, generation, instance,
          tickets: runtime.store.tickets.list(), triggers, settings: runtime.store.settings(),
          decisions: runtime.store.db.prepare('SELECT value FROM decision ORDER BY rowid').all().map(row => JSON.parse(String(row.value))),
          dispositions: triggers.map(trigger => ({ id: trigger.id, value: runtime.store.triggers.disposition(trigger.id) })),
          outbox: runtime.store.db.prepare('SELECT value FROM outbox ORDER BY rowid').all().map(row => JSON.parse(String(row.value))),
        }, null, 2));
        renameSync(`${snapshotPath}.next`, snapshotPath);
      } catch { /* Checkpoint closes the old database before disposing the observer. */ }
    };
    snapshot();
    const timer = setInterval(snapshot, 50);
    child.effect(() => () => { clearInterval(timer); snapshot(); });
  });
}
