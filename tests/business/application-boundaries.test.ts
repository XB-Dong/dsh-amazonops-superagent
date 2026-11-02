import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Business } from '../../packages/business/index.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-boundary-'));
  const business = new Business(directory);
  return { business, close() { business.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('snapshot is a pure query and does not consume pending capture work', () => {
  const f = fixture();
  try {
    f.business.capture.enqueue('main', '希望增加一个更方便的入口', 'source-query');
    f.business.snapshot('main');
    assert.equal(f.business.store.list('main', 'feedback').length, 0);
    assert.equal(f.business.store.list<{ id: string; scope: string; kind: string; revision: number; createdAt: string; updatedAt: string; status: string }>('main', 'job')[0].status, 'pending');
    f.business.tick('main');
    assert.equal(f.business.store.list('main', 'feedback').length, 1);
  } finally { f.close(); }
});

test('a stable command requestId rejects a changed payload and replays an identical one', () => {
  const f = fixture();
  try {
    const input = { requestId: 'note-request', title: '记录', content: '第一版' };
    const first = f.business.command('main', 'note', input) as { id: string };
    const replay = f.business.command('main', 'note', { ...input }) as { id: string };
    assert.equal(first.id, replay.id);
    assert.throws(() => f.business.command('main', 'note', { ...input, content: '第二版' }), /REQUEST_CONFLICT/);
    assert.equal(f.business.store.list('main', 'note').length, 1);
  } finally { f.close(); }
});

test('successful tasks publish pending work and learning consumes it only during tick', () => {
  const f = fixture();
  try {
    const task = f.business.command('main', 'task', { requestId: 'task-request', title: '流程', checklist: ['核对清单'], timeZone: 'Asia/Shanghai' }) as { id: string; revision: number };
    f.business.command('main', 'task-update', { id: task.id, revision: task.revision, status: 'done', checked: [true], confirmedSuccess: true });
    assert.equal(f.business.store.list('main', 'skill').length, 0);
    f.business.tick('main');
    assert.equal(f.business.store.list('main', 'skill').length, 1);
  } finally { f.close(); }
});
