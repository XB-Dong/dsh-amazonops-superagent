import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Business, type Task } from '../../packages/business/index.ts';

test('trusted operation identity survives reopening and distinguishes genuinely new requests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-operation-'));
  let business = new Business(directory);
  try {
    const source = business.store.source('main', 'Create an internal draft');
    const input = { title: 'Draft', checklist: ['Verify'], timeZone: 'Asia/Shanghai' };
    assert.throws(() => business.tool('main', source.id, 'prepare_task', input), /OPERATION_REQUIRED/);
    const first = business.tool('main', source.id, 'prepare_task', input, 'persisted-operation') as Task;
    business.close();
    business = new Business(directory);
    const replay = business.tool('main', source.id, 'prepare_task', { ...input }, 'persisted-operation') as Task;
    assert.deepEqual(replay, first);
    assert.throws(() => business.tool('main', source.id, 'prepare_task', { ...input, title: 'Changed' }, 'persisted-operation'), /REQUEST_CONFLICT/);
    const newSource = business.store.source('main', 'Create a second identical draft');
    const second = business.tool('main', newSource.id, 'prepare_task', input, 'second-operation') as Task;
    assert.notEqual(second.id, first.id);
    assert.equal(business.store.list('main', 'task').length, 2);
    business.store.remove('main', source.id);
    assert.throws(() => business.tool('main', source.id, 'prepare_task', input, 'persisted-operation'), /NOT_FOUND|DERIVATION_REVOKED/);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a successful flow remains pending while learning is paused and query never drains it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-learning-event-'));
  const business = new Business(directory);
  try {
    const task = business.command('main', 'task', { requestId: 'flow', title: 'Flow', checklist: ['Verify'], timeZone: 'UTC' }) as Task;
    business.learning.setEnabled('main', false);
    business.command('main', 'task-update', { id: task.id, revision: task.revision, status: 'done', checked: [true], confirmedSuccess: true });
    business.tick('main');
    assert.equal(business.learning.activeSkills('main').length, 0);
    assert.equal(business.snapshot('main').jobs.some(job => job.status === 'pending'), true);
    business.learning.setEnabled('main', true);
    business.snapshot('main');
    assert.equal(business.learning.activeSkills('main').length, 0);
    business.tick('main');
    assert.equal(business.learning.activeSkills('main').length, 1);
    business.tick('main');
    assert.equal(business.learning.activeSkills('main').length, 1);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('activity multi-task creation rolls back every source and task when one stage fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-activity-atomic-'));
  const business = new Business(directory);
  try {
    const originalCreate = business.store.create.bind(business.store);
    let count = 0;
    business.store.create = ((scope, kind, data, id) => {
      if (kind === 'task' && ++count === 2) throw new Error('SYNTHETIC_STAGE_FAILURE');
      return originalCreate(scope, kind, data, id);
    }) as typeof business.store.create;
    assert.throws(() => business.command('main', 'activity', {
      requestId: 'activity', title: 'Sale', store: 'Store', listing: 'Item', timeZone: 'UTC',
      startAt: '2026-11-04T10:00:00Z', endAt: '2026-11-05T10:00:00Z', leadHours: 4,
    }), /SYNTHETIC_STAGE_FAILURE/);
    assert.equal(business.store.list('main', 'task').length, 0);
    assert.equal(business.store.list('main', 'source').length, 0);
    assert.equal(business.store.db.prepare('SELECT COUNT(*) AS n FROM receipts').get()?.n, 0);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});
