import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Learning } from '../../packages/business/learning/service.ts';
import { Tasks } from '../../packages/business/operations/tasks.ts';

test('task draft confirmation, idempotency and successful workflow promotion are enforced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-tasks-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const learning = new Learning(store);
  const tasks = new Tasks(store, learning);
  try {
    const source = store.source('a', '活动准备');
    const input = {
      title: '活动准备',
      sourceId: source.id,
      timeZone: 'America/Los_Angeles',
      checklist: ['核对时区', '检查价格'],
    };
    assert.throws(() => tasks.create('a', 'bad', { ...input, timeZone: '' }), /TIME_ZONE_REQUIRED/);
    let task = tasks.create('a', 'same', input);
    assert.equal(task.status, 'draft');
    assert.equal(tasks.create('a', 'same', input).id, task.id);
    assert.throws(() => tasks.update('b', task.id, 1, { status: 'done' }), /NOT_FOUND/);
    assert.throws(
      () => tasks.update('a', task.id, 1, { status: 'done', confirmedSuccess: true }),
      /INVALID_TASK_TRANSITION/,
    );
    task = tasks.update('a', task.id, task.revision, { status: 'open' });
    assert.throws(
      () => tasks.update('a', task.id, 1, { checked: [true, true] }),
      /REVISION_CONFLICT/,
    );
    assert.throws(
      () => tasks.update('a', task.id, task.revision, { status: 'done', confirmedSuccess: true }),
      /CHECKLIST_INCOMPLETE/,
    );
    task = tasks.update('a', task.id, task.revision, { checked: [true, true] });
    task = tasks.update('a', task.id, task.revision, { status: 'done', confirmedSuccess: true });
    learning.drainWorkflows('a');
    assert.equal(learning.activeSkills('a').length, 1);
    assert.equal(task.confirmedSuccess, true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pausing learning preserves pending successful workflows until learning resumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-workflow-pause-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const learning = new Learning(store);
  const tasks = new Tasks(store, learning);
  try {
    const source = store.source('a', 'Synthetic successful flow');
    const task = store.create('a', 'task', {
      title: 'Synthetic flow',
      status: 'done',
      checklist: ['Check one'],
      checked: [true],
      confirmedSuccess: true,
      timeZone: 'Asia/Shanghai',
      sources: [source.id],
    });
    const job = store.create('a', 'job', {
      taskId: task.id,
      type: 'workflow',
      status: 'pending',
      attempts: 0,
    });
    learning.setEnabled('a', false);
    learning.drainWorkflows('a');
    assert.equal(store.get<typeof job>('a', job.id).status, 'pending');
    assert.equal(learning.activeSkills('a').length, 0);
    learning.setEnabled('a', true);
    learning.drainWorkflows('a');
    assert.equal(store.get<typeof job>('a', job.id).status, 'completed');
    learning.drainWorkflows('a');
    assert.equal(learning.activeSkills('a').length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
