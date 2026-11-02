import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Business } from '../../packages/business/index.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-task-copy-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const business = new Business(store, dir);
  const original = business.mutate('synthetic', 'task', {
    requestId: 'origin',
    title: 'ItemA+1 preparation',
    timeZone: 'Europe/Rome',
    startAt: '2026-10-27T09:00:00+01:00',
    endAt: '2026-10-27T10:00:00+01:00',
    checklist: ['Check ItemA+1', 'Keep ItemAAA1'],
  }) as any;
  return {
    dir,
    store,
    business,
    original,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('task copy literally replaces identifiers, resets completed fields and leaves source unchanged', () => {
  const f = fixture();
  try {
    const original = f.store.update(f.original, {
      status: 'done',
      checked: [true, true],
      confirmedSuccess: true,
      actualMinutes: 35,
      completedAt: '2026-10-27T10:00:00Z',
    });
    const body = {
      requestId: 'copy',
      taskId: original.id,
      revision: original.revision,
      replaceFrom: 'ItemA+1',
      replaceTo: 'ItemB',
    };
    const copy = f.business.mutate('synthetic', 'task-copy', body) as any;
    assert.equal(copy.title, 'ItemB preparation');
    assert.deepEqual(copy.checklist, ['Check ItemB', 'Keep ItemAAA1']);
    assert.deepEqual(copy.checked, [false, false]);
    assert.equal(copy.status, 'draft');
    assert.equal(copy.confirmedSuccess, false);
    assert.equal(copy.timeZone, original.timeZone);
    for (const field of ['startAt', 'endAt', 'dueAt', 'completedAt', 'actualMinutes'])
      assert.equal(copy[field], undefined);
    assert.notEqual(copy.id, original.id);
    assert.ok(copy.sources.includes(original.id));
    assert.deepEqual(f.store.get('synthetic', original.id), original);
    f.store.update(original, { actualMinutes: 36 });
    assert.deepEqual(f.business.mutate('synthetic', 'task-copy', body), copy);
    assert.throws(
      () => f.business.mutate('synthetic', 'task-copy', { ...body, title: 'Changed' }),
      /COPY_REQUEST_CONFLICT/,
    );
    assert.equal(f.store.list('synthetic', 'task').length, 2);
  } finally {
    f.close();
  }
});

test('invalid copies fail atomically without orphan sources or jobs and enforce scope/revision', () => {
  const f = fixture();
  try {
    const valid = { requestId: 'copy', taskId: f.original.id, revision: 1 };
    const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM entities').get();
    for (const change of [
      { revision: 0 },
      { revision: '1' },
      { revision: 2 },
      { title: '' },
      { replaceFrom: 'A' },
      { replaceFrom: '', replaceTo: 'B' },
      { title: 'a'.repeat(201) },
      { extra: true },
      { requestId: '' },
      { requestId: 'x'.repeat(101) },
    ]) {
      assert.throws(() => f.business.mutate('synthetic', 'task-copy', { ...valid, ...change }));
      assert.deepEqual(f.store.db.prepare('SELECT COUNT(*) AS n FROM entities').get(), before);
    }
    assert.throws(() => f.business.mutate('other', 'task-copy', valid), /NOT_FOUND/);
    const source = f.store.source('synthetic', 'Request');
    assert.throws(
      () => f.business.mutate('synthetic', 'task-copy', { ...valid, taskId: source.id }),
      /INVALID_TASK/,
    );
    f.store.update(f.original, { checklist: ['a'.repeat(300)] });
    assert.throws(
      () =>
        f.business.mutate('synthetic', 'task-copy', {
          ...valid,
          revision: 2,
          replaceFrom: 'a',
          replaceTo: 'bb',
        }),
      /INVALID_TASK/,
    );
  } finally {
    f.close();
  }
});

test('read task detail is scoped, paged, byte bounded, strict and read only', () => {
  const f = fixture();
  try {
    const steps = Array.from({ length: 30 }, (_, i) => `${i}` + '中'.repeat(298));
    f.store.update(f.original, { checklist: steps, checked: steps.map(() => false) });
    const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM entities').get();
    const all: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const result = f.business.tool('synthetic', undefined, 'get_task', {
        taskId: f.original.id,
        offset,
      }) as any;
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 6000);
      assert.equal(result.task.revision, 2);
      assert.equal(result.totalItems, 30);
      all.push(...result.checklist);
      offset = result.nextOffset;
    }
    assert.deepEqual(all, steps);
    assert.deepEqual(f.store.db.prepare('SELECT COUNT(*) AS n FROM entities').get(), before);
    for (const offset of [-1, 0.5, '0', null])
      assert.throws(() =>
        f.business.tool('synthetic', undefined, 'get_task', { taskId: f.original.id, offset }),
      );
    assert.throws(
      () => f.business.tool('other', undefined, 'get_task', { taskId: f.original.id }),
      /NOT_FOUND/,
    );
    assert.throws(() =>
      f.business.tool('synthetic', undefined, 'get_task', { taskId: f.original.id, extra: true }),
    );
    f.store.update(f.store.get('synthetic', f.original.id), { title: '中'.repeat(6000) } as any);
    assert.throws(
      () => f.business.tool('synthetic', undefined, 'get_task', { taskId: f.original.id }),
      /TASK_DETAIL_TOO_LARGE/,
    );
  } finally {
    f.close();
  }
});

test('model copy requires current source, is deterministic and follows deletion plus restored privacy ledger', () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    const source = f.store.source('synthetic', 'Please copy the synthetic task');
    const body = { taskId: f.original.id, revision: 1 };
    assert.throws(
      () => f.business.tool('synthetic', undefined, 'copy_task', body),
      /SOURCE_REQUIRED/,
    );
    const copy = f.business.tool('synthetic', source.id, 'copy_task', body, 'copy-operation') as any;
    assert.deepEqual(f.business.tool('synthetic', source.id, 'copy_task', body, 'copy-operation'), copy);
    assert.ok((f.store.get('synthetic', copy.id) as any).sources.includes(source.id));
    assert.ok(Buffer.byteLength(JSON.stringify(copy)) <= 6000);
    const backup = join(f.dir, 'saved.sqlite');
    f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(join(f.dir, 'business.sqlite'), backup);
    f.store.remove('synthetic', f.original.id);
    assert.throws(() => f.store.get('synthetic', copy.id), /NOT_FOUND/);
    assert.throws(
      () => f.business.tool('synthetic', source.id, 'copy_task', body, 'copy-operation'),
      /DERIVATION_REVOKED|NOT_FOUND/,
    );
    restored = new Store(backup);
    assert.throws(() => restored!.get('synthetic', copy.id), /NOT_FOUND/);
  } finally {
    restored?.close();
    f.close();
  }
});

test('copy rejects corrupt legacy timezones atomically and bounds valid model confirmations', () => {
  const f = fixture();
  try {
    const source = f.store.source('synthetic', 'Copy synthetic task');
    for (const timeZone of ['Invalid/Zone', 'A'.repeat(7000)]) {
      const original = f.store.update(f.store.get('synthetic', f.original.id), { timeZone } as any);
      const counts = () => ({
        entities: f.store.db.prepare('SELECT COUNT(*) AS n FROM entities').get(),
        receipts: f.store.db.prepare('SELECT COUNT(*) AS n FROM receipts').get(),
      });
      const before = counts();
      const body = { taskId: original.id, revision: original.revision };
      assert.throws(
        () => f.business.mutate('synthetic', 'task-copy', { ...body, requestId: 'invalid-zone' }),
        /INVALID_TIME_ZONE/,
      );
      assert.deepEqual(counts(), before);
      assert.throws(
        () => f.business.tool('synthetic', source.id, 'copy_task', body, 'copy-operation'),
        /INVALID_TIME_ZONE/,
      );
      assert.deepEqual(counts(), before);
    }
    const original = f.store.update(f.store.get('synthetic', f.original.id), {
      timeZone: 'Asia/Shanghai',
      title: '中'.repeat(200),
      checklist: Array.from({ length: 30 }, () => '中'.repeat(300)),
    } as any);
    const result = f.business.tool('synthetic', source.id, 'copy_task', {
      taskId: original.id,
      revision: original.revision,
    }, 'final-copy-operation') as any;
    assert.equal(result.totalItems, 30);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 6000);
  } finally {
    f.close();
  }
});
