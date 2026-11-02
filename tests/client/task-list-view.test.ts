import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPreview, taskListGroups } from '../../packages/client/task-list-view.ts';

test('list days always follow Beijing across UTC and Rome winter/summer boundaries', () => {
  const rows = [
    { id: 'winter', createdAt: '2026-10-28T17:30:00+01:00', status: 'open' },
    { id: 'summer', createdAt: '2026-06-01T19:00:00+02:00', status: 'open' },
  ];
  assert.deepEqual(
    taskListGroups(rows, 'all', '').map((group) => group.date),
    ['2026-10-29', '2026-06-02'],
  );
});

test('selected empty date remains an explicit group after status filtering', () => {
  const rows = [{ id: 'done', createdAt: '2026-10-28T17:00:00Z', status: 'done' }];
  assert.deepEqual(taskListGroups(rows, 'active', '2026-10-29'), [
    { date: '2026-10-29', tasks: [] },
  ]);
  assert.equal(taskListGroups(rows, 'all', '2026-10-29')[0].tasks.length, 1);
});

test('date filter excludes unknown dates and other days without guessing or mutation', () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'unknown', status: 'open' }),
    Object.freeze({ id: 'a', createdAt: '2026-10-28T17:00:00Z', status: 'open' }),
    Object.freeze({ id: 'b', createdAt: '2026-10-27T17:00:00Z', status: 'open' }),
  ]);
  assert.deepEqual(
    taskListGroups(rows, 'all', '2026-10-29')[0].tasks.map((task) => task.id),
    ['a'],
  );
  assert.equal(taskListGroups(rows, 'all', '').at(-1)?.date, null);
  assert.equal('createdAt' in rows[1] && rows[1].createdAt, '2026-10-28T17:00:00Z');
});

test('malformed or impossible selected dates do not silently select all records', () => {
  for (const date of ['2026-02-30', '2026-2-01', 'oops'])
    assert.throws(() => taskListGroups([], 'all', date), /日期/);
});

test('copy preview uses case-sensitive literal replacement including regex punctuation', () => {
  const task = Object.freeze({
    title: 'ItemA+1检查',
    checklist: Object.freeze(['ItemA+1 / ItemA+1', 'itema+1不变']) as unknown as string[],
  });
  assert.deepEqual(copyPreview(task, '', 'ItemA+1', 'ItemB'), {
    title: 'ItemB检查',
    checklist: ['ItemB / ItemB', 'itema+1不变'],
  });
  assert.equal(task.title, 'ItemA+1检查');
  assert.equal(task.checklist[0], 'ItemA+1 / ItemA+1');
});

test('copy preview validates paired replacement and final text lengths before submission', () => {
  const task = { title: 'Base', checklist: ['A'.repeat(300)] };
  assert.throws(() => copyPreview(task, '', 'A', ''), /同时填写/);
  assert.throws(() => copyPreview(task, '', '', 'B'), /同时填写/);
  assert.throws(() => copyPreview(task, '', '  ', '  '), /同时填写/);
  assert.throws(() => copyPreview(task, '', 'A', '  '), /同时填写/);
  assert.throws(() => copyPreview(task, '', 'A', 'BB'), /300/);
  assert.throws(() => copyPreview(task, 'X'.repeat(201), '', ''), /200/);
  assert.deepEqual(copyPreview({ title: 'Original', checklist: ['step'] }, 'Custom', '', ''), {
    title: 'Custom',
    checklist: ['step'],
  });
  assert.equal(
    copyPreview({ title: 'Original', checklist: ['step'] }, ' Custom ', '', '').title,
    'Custom',
  );
});
