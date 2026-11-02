/** Read-only test observer. No Engine commands, model responses or tool registrations. */
import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Runtime } from '../../vendor/superagent/src/extension.ts';

export const inject = ['sessionPersistence'];
export function apply(ctx: Context, config: { evidence: string }): void {
  // Windows process.kill cannot deliver a catchable SIGTERM. Relay only the test's
  // private IPC message into the official launcher's already-installed signal handler.
  const shutdown = (message: unknown) => { if (message === 'native-e2e-graceful-stop') process.emit('SIGTERM'); };
  process.on('message', shutdown);
  ctx.effect(() => () => { process.off('message', shutdown); });
  ctx.on('session/event', (session, event) => {
    appendFileSync(join(config.evidence, 'session-events.jsonl'), JSON.stringify({ sessionId: session.id, event }) + '\n');
  }, { global: true });
  ctx.inject(['orchestrator'], async child => {
    const runtime = child.get('orchestrator') as unknown as Runtime;
    await runtime.ready;
    const snapshot = () => {
      try {
        const triggers = runtime.store.read.triggers({ source: 'amazonops' }, 0, 500).items;
        writeFileSync(join(config.evidence, 'native-state.json'), JSON.stringify({
          engine: runtime.engine.constructor.name, store: runtime.store.constructor.name,
          executor: runtime.executor.constructor.name, masterId: runtime.masterId,
          tickets: runtime.store.tickets.list(), triggers, settings: runtime.store.settings(),
          decisions: runtime.store.db.prepare('SELECT value FROM decision ORDER BY rowid').all().map(row => JSON.parse(String(row.value))),
          dispositions: triggers.map(trigger => ({ id: trigger.id, value: runtime.store.triggers.disposition(trigger.id) })),
          outbox: runtime.store.db.prepare('SELECT value FROM outbox ORDER BY rowid').all().map(row => JSON.parse(String(row.value))),
        }, null, 2));
      } catch { /* Checkpoint closes the old database before disposing the observer. */ }
    };
    snapshot();
    const timer = setInterval(snapshot, 50);
    child.effect(() => () => { clearInterval(timer); snapshot(); });
  });
}
