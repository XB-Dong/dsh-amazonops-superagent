import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Learning, type Task } from '../../packages/business/learning/service.ts';
import { Tasks } from '../../packages/business/operations/tasks.ts';

function fixture(run: (store: Store, tasks: Tasks, task: Task) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-task-edit-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const tasks = new Tasks(store, new Learning(store));
  try {
    const source = store.source('a', 'Synthetic task source');
    const task = tasks.create('a', 'initial', {
      title: 'Original task',
      checklist: ['First', 'Second'],
      sourceId: source.id,
      timeZone: 'Europe/Rome',
      confirmed: true,
    });
    run(store, tasks, task);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('editing an open task retains identity and only unchanged positioned checks', () => {
  fixture((store, tasks, original) => {
    const checked = tasks.update('a', original.id, original.revision, { checked: [true, true] });
    const task = tasks.update('a', checked.id, checked.revision, {
      title: ' Revised task ',
      checklist: ['First', 'Changed', 'Third'],
    } as never);
    assert.equal(task.title, 'Revised task');
    assert.equal(task.id, original.id);
    assert.deepEqual(task.sources, original.sources);
    assert.deepEqual(task.checked, [true, false, false]);
    assert.throws(
      () => tasks.update('a', task.id, original.revision, { status: 'cancelled' }),
      /REVISION_CONFLICT/,
    );
    assert.throws(
      () => tasks.update('b', task.id, task.revision, { status: 'cancelled' }),
      /NOT_FOUND/,
    );
    assert.equal(store.list('a', 'task').length, 1);
  });
});

test('task domain rejects malformed and undeclared fields rather than injecting metadata', () => {
  fixture((store, tasks, task) => {
    for (const changes of [
      null,
      [],
      { title: 2 },
      { checklist: 'bad' },
      { checked: 'bad' },
      { checked: [true] },
      { checked: [true, 1] },
      { confirmedSuccess: 'true' },
      { status: 1 },
      { status: '' },
      { title: '' },
      { timeZone: null },
      { sources: [] },
      { completedAt: '2000-01-01T00:00:00Z' },
      { kind: 'source' },
    ]) {
      assert.throws(
        () => tasks.update('a', task.id, task.revision, changes as never),
        JSON.stringify(changes),
      );
    }
    assert.equal(store.get<Task>('a', task.id).revision, task.revision);
    for (const changes of [
      { title: null },
      { checklist: {} },
      { dueAt: 1 },
      { confirmed: 'yes' },
    ]) {
      assert.throws(() =>
        tasks.create('a', 'invalid', {
          title: 'Task',
          timeZone: 'Europe/Rome',
          checklist: ['First'],
          sourceId: task.sources[0],
          ...changes,
        } as never),
      );
    }
  });
});

test('schedules synchronize dueAt, preserve legacy input and clear only explicitly submitted fields', () => {
  fixture((store, tasks, task) => {
    const next = tasks.update('a', task.id, task.revision, {
      startAt: '2026-10-27T09:00:00+01:00',
      endAt: '2026-10-27T10:15:00+01:00',
    } as never);
    assert.equal(next.startAt, '2026-10-27T09:00:00+01:00');
    assert.equal(next.endAt, next.dueAt);
    const legacy = tasks.create('a', 'legacy', {
      title: 'Legacy',
      timeZone: 'Europe/Rome',
      checklist: ['First'],
      sourceId: task.sources[0],
      dueAt: '2026-10-27T11:37+01:00',
    });
    const renamed = tasks.update('a', legacy.id, legacy.revision, {
      title: 'Legacy renamed',
    } as never);
    assert.equal(renamed.dueAt, legacy.dueAt);
    const cleared = tasks.update('a', next.id, next.revision, { endAt: null } as never);
    assert.equal(cleared.endAt, undefined);
    assert.equal(cleared.dueAt, undefined);
    assert.equal(cleared.startAt, next.startAt);
    assert.equal(store.get<Task>('a', next.id).dueAt, undefined);
  });
});

test('schedule validation rejects wrong offsets, impossible dates, missing offsets and reversed times', () => {
  fixture((_store, tasks, task) => {
    for (const startAt of [
      '2026-10-27T09:00:00',
      '2026-02-30T09:00:00+01:00',
      '2026-10-27T09:00:00+02:00',
      '2026-03-29T02:30:00+01:00',
      '',
      'not-a-date',
    ]) {
      assert.throws(() => tasks.update('a', task.id, task.revision, { startAt } as never));
    }
    for (const endAt of ['2026-10-27T08:00:00+01:00', '2026-10-27T09:00:00+01:00']) {
      assert.throws(
        () =>
          tasks.update('a', task.id, task.revision, {
            startAt: '2026-10-27T09:00:00+01:00',
            endAt,
          } as never),
        /TASK_TIME_ORDER/,
      );
    }
    assert.throws(
      () =>
        tasks.create('a', 'wrong-offset', {
          title: 'Task',
          timeZone: 'Europe/Rome',
          checklist: ['First'],
          sourceId: task.sources[0],
          dueAt: '2026-10-27T09:00:00Z',
        }),
      /SITE_TIME_MISMATCH/,
    );
    assert.throws(
      () =>
        tasks.update('a', task.id, task.revision, {
          endAt: '2026-10-27T10:00:00+01:00',
          dueAt: '2026-10-27T11:00:00+01:00',
        } as never),
      /TASK_END_DUE_MISMATCH/,
    );
  });
});

test('changing timezone requires resubmitting or clearing existing scheduled fields', () => {
  fixture((_store, tasks, task) => {
    const scheduled = tasks.update('a', task.id, task.revision, {
      startAt: '2026-10-27T09:00:00+01:00',
      endAt: '2026-10-27T10:00:00+01:00',
    } as never);
    assert.throws(
      () => tasks.update('a', task.id, scheduled.revision, { timeZone: 'Europe/Paris' } as never),
      /TIME_ZONE_SCHEDULE_REQUIRED/,
    );
    const changed = tasks.update('a', task.id, scheduled.revision, {
      timeZone: 'Asia/Shanghai',
      startAt: '2026-10-27T16:00:00+08:00',
      endAt: '2026-10-27T17:00:00+08:00',
    } as never);
    assert.equal(changed.timeZone, 'Asia/Shanghai');
    assert.equal(changed.endAt, changed.dueAt);
    const cleared = tasks.update('a', task.id, changed.revision, {
      timeZone: 'Europe/Rome',
      startAt: null,
      endAt: null,
    } as never);
    assert.equal(cleared.startAt, undefined);
    assert.equal(cleared.endAt, undefined);
    assert.equal(cleared.dueAt, undefined);
  });
});

test('completed tasks receive one server completion time, allow duration corrections, never duplicate jobs', () => {
  fixture((store, tasks, task) => {
    const before = Date.now();
    const done = tasks.update('a', task.id, task.revision, {
      status: 'done',
      checked: [true, true],
      confirmedSuccess: true,
      actualMinutes: 30,
    } as never);
    assert.ok(done.completedAt && Date.parse(done.completedAt) >= before);
    assert.equal(done.actualMinutes, 30);
    assert.equal(store.list('a', 'job').length, 1);
    new Learning(store).drainWorkflows('a');
    assert.equal(store.list('a', 'skill').length, 1);
    let corrected = tasks.update('a', done.id, done.revision, {
      status: 'done',
      checked: [true, true],
      confirmedSuccess: true,
      actualMinutes: 45,
    } as never);
    assert.equal(corrected.completedAt, done.completedAt);
    assert.equal(corrected.actualMinutes, 45);
    corrected = tasks.update('a', done.id, corrected.revision, {
      actualMinutes: undefined,
    } as never);
    assert.equal(corrected.actualMinutes, 45);
    corrected = tasks.update('a', done.id, corrected.revision, { actualMinutes: null } as never);
    assert.equal(corrected.actualMinutes, null);
    assert.equal(store.list('a', 'job').length, 1);
    for (const changes of [
      { title: 'Altered' },
      { checklist: ['Altered'] },
      { timeZone: 'UTC' },
      { checked: [false, true] },
      { confirmedSuccess: false },
    ]) {
      assert.throws(() => tasks.update('a', done.id, corrected.revision, changes as never));
    }
  });
});

test('actual minutes must be a finite whole number between zero and one day', () => {
  fixture((_store, tasks, task) => {
    for (const actualMinutes of [-1, 1441, 0.5, NaN, Infinity, '30', false]) {
      assert.throws(
        () => tasks.update('a', task.id, task.revision, { actualMinutes } as never),
        /INVALID_ACTUAL_MINUTES/,
      );
    }
    const zero = tasks.update('a', task.id, task.revision, { actualMinutes: 0 } as never);
    assert.equal(zero.actualMinutes, 0);
    const maximum = tasks.update('a', task.id, zero.revision, { actualMinutes: 1440 } as never);
    assert.equal(maximum.actualMinutes, 1440);
  });
});

test('cancelled tasks and historic done records cannot acquire invented completion dates', () => {
  fixture((store, tasks, task) => {
    const cancelled = tasks.update('a', task.id, task.revision, { status: 'cancelled' });
    assert.equal(cancelled.completedAt, undefined);
    assert.throws(() =>
      tasks.update('a', task.id, cancelled.revision, { title: 'Changed' } as never),
    );
    const historic = store.create('a', 'task', { ...task, status: 'done', checked: [true, true] });
    const corrected = tasks.update('a', historic.id, historic.revision, {
      actualMinutes: 10,
    } as never);
    assert.equal(corrected.completedAt, undefined);
    assert.equal(corrected.actualMinutes, 10);
  });
});

test('unrelated edits preserve preexisting legacy offset data, while explicit changes are validated', () => {
  fixture((store, tasks, task) => {
    const legacy = store.update(task, { dueAt: '2026-10-27T09:37:00Z' });
    const renamed = tasks.update('a', legacy.id, legacy.revision, { title: 'Legacy kept' });
    assert.equal(renamed.dueAt, legacy.dueAt);
    assert.equal(renamed.startAt, undefined);
    assert.equal(renamed.endAt, undefined);
    assert.throws(
      () =>
        tasks.update('a', legacy.id, renamed.revision, {
          dueAt: legacy.dueAt,
        }),
      /SITE_TIME_MISMATCH/,
    );
    const cleared = tasks.update('a', legacy.id, renamed.revision, { dueAt: null });
    assert.equal(cleared.dueAt, undefined);
  });
});

test('explicit schedule input handles both Italian seasonal offsets and retains source idempotency', () => {
  fixture((_store, tasks, task) => {
    const winter = tasks.create('a', 'schedule', {
      title: 'Seasonal task',
      checklist: ['First'],
      timeZone: 'Europe/Rome',
      sourceId: task.sources[0],
      startAt: '2026-01-27T09:00:00+01:00',
      endAt: '2026-01-27T10:00:00+01:00',
    });
    assert.equal(winter.dueAt, winter.endAt);
    const summer = tasks.update('a', winter.id, winter.revision, {
      startAt: '2026-07-27T09:00:00+02:00',
      endAt: '2026-07-27T10:00:00+02:00',
    });
    assert.equal(summer.endAt, summer.dueAt);
    const replay = tasks.create('a', 'schedule', {
      title: 'Duplicate request',
      checklist: ['First'],
      timeZone: 'Europe/Rome',
      sourceId: task.sources[0],
    });
    assert.equal(replay.id, winter.id);
  });
});
