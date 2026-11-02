import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Business } from '../../packages/business/index.ts';

test('business command writes a durable derived event once in the same transaction as its receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-outbox-'));
  let business = new Business(directory);
  try {
    const input = { requestId: 'note', title: 'Note', content: 'Private business text' };
    const result = business.command('main', 'note', input) as { id: string };
    const table = business.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_events'").get();
    assert.ok(table, 'a committed command must have a durable business event projection');
    const events = () => business.store.db.prepare('SELECT * FROM business_events WHERE scope=?').all('main');
    assert.equal(events().length, 1);
    assert.equal(events()[0].entity_id, result.id);
    assert.ok(!JSON.stringify(events()).includes(input.content));
    business.command('main', 'note', input);
    assert.equal(events().length, 1);
    assert.throws(() => business.command('main', 'note', { ...input, content: 'Changed' }), /REQUEST_CONFLICT/);
    assert.equal(events().length, 1);
    business.close(); business = new Business(directory);
    assert.equal(events().length, 1);
    const before = events().length;
    business.snapshot('main');
    assert.equal(events().length, before);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});
