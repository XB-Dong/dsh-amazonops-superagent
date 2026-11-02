import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../packages/contracts/model.ts';
import { projectWorkCalendar } from '../../packages/client/work-calendar.ts';
import { localFields } from '../../packages/client/task-time.ts';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, scope: 'main', kind: 'task', revision: 1, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', title: id, status: 'done', checklist: ['Synthetic check'],
    checked: [true], confirmedSuccess: true, timeZone: 'Europe/Rome', sources: [], ...overrides };
}
const ids = (rows: readonly Task[]) => rows.map(row => row.id);

test('completion instants cross UTC midnight according to the selected calendar zone', () => {
  const rows = [task('before-utc-midnight', { completedAt: '2026-11-01T23:30:00Z', actualMinutes: 15 }),
    task('after-utc-midnight', { completedAt: '2026-11-02T00:30:00Z', actualMinutes: 25 })];
  assert.deepEqual(ids(projectWorkCalendar(rows, '2026-11-01', 'UTC').rows), ['before-utc-midnight']);
  const beijing = projectWorkCalendar(rows, '2026-11-02', 'Asia/Shanghai');
  assert.deepEqual(ids(beijing.rows), ['after-utc-midnight', 'before-utc-midnight']);
  assert.equal(beijing.minutes, 40);
  assert.equal(projectWorkCalendar(rows, '2026-11-01', 'America/New_York').rows.length, 2);
});

test('New York repeated DST hour keeps both distinct completions on their real local day', () => {
  const first = '2026-11-01T05:30:00Z', second = '2026-11-01T06:30:00Z';
  assert.deepEqual(localFields(first, 'America/New_York'), { date: '2026-11-01', time: '01:30' });
  assert.deepEqual(localFields(second, 'America/New_York'), { date: '2026-11-01', time: '01:30' });
  const result = projectWorkCalendar([
    task('first-hour', { completedAt: first, actualMinutes: 12 }),
    task('second-hour', { completedAt: second, actualMinutes: 13 }),
    task('previous-day', { completedAt: '2026-11-01T03:59:00Z', actualMinutes: 99 }),
  ], '2026-11-01', 'America/New_York');
  assert.deepEqual(ids(result.rows), ['second-hour', 'first-hour']);
  assert.equal(result.minutes, 25);
});

test('New York DST skipped hour groups the instants before and after the clock jump once each', () => {
  const before = '2026-03-08T06:59:00Z', after = '2026-03-08T07:00:00Z';
  assert.equal(localFields(before, 'America/New_York').time, '01:59');
  assert.equal(localFields(after, 'America/New_York').time, '03:00');
  const result = projectWorkCalendar([
    task('before-jump', { completedAt: before, actualMinutes: 8 }),
    task('after-jump', { completedAt: after, actualMinutes: 9 }),
    task('previous-day', { completedAt: '2026-03-08T04:59:00Z', actualMinutes: 99 }),
  ], '2026-03-08', 'America/New_York');
  assert.deepEqual(ids(result.rows), ['after-jump', 'before-jump']);
  assert.equal(result.minutes, 17);
});

test('unfinished and undated completions never enter the selected day or its minute total', () => {
  const result = projectWorkCalendar([
    ...['draft', 'open', 'cancelled'].map(status => task(status, {
      status, completedAt: '2026-11-02T01:00:00Z', actualMinutes: 100,
    })),
    task('undated', { actualMinutes: 80 }),
    task('invalid-date', { completedAt: 'invalid', actualMinutes: 90 }),
    task('completed', { completedAt: '2026-11-02T01:00:00Z', actualMinutes: 10 }),
  ], '2026-11-02', 'Asia/Shanghai');
  assert.deepEqual(ids(result.rows), ['completed']);
  assert.deepEqual(ids(result.unknown), ['invalid-date', 'undated']);
  assert.equal(result.minutes, 10);
});

test('missing actual minutes stay unrecorded, zero is recorded, and plans never supply actual work', () => {
  const common = { completedAt: '2026-11-02T01:00:00Z',
    startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-02T00:00:00Z', dueAt: '2026-11-03T00:00:00Z' };
  const result = projectWorkCalendar([
    task('null', { ...common, actualMinutes: null }), task('undefined', common),
    task('zero', { ...common, actualMinutes: 0 }), task('recorded', { ...common, actualMinutes: 37 }),
  ], '2026-11-02', 'Asia/Shanghai');
  assert.equal(result.rows.length, 4);
  assert.deepEqual(ids(result.recorded), ['recorded', 'zero']);
  assert.equal(result.rows.length - result.recorded.length, 2);
  assert.equal(result.minutes, 37);
});

test('projection leaves frozen input order and task fields unchanged, including empty date selection', () => {
  const input = [task('z', { completedAt: '2026-11-02T01:00:00Z', actualMinutes: 5 }),
    task('a', { completedAt: '2026-11-02T02:00:00Z', actualMinutes: null }), task('unknown')];
  const before = structuredClone(input);
  for (const row of input) { Object.freeze(row.checked); Object.freeze(row.checklist); Object.freeze(row.sources); Object.freeze(row); }
  Object.freeze(input);
  const result = projectWorkCalendar(input, '2026-11-02', 'Asia/Shanghai');
  assert.deepEqual(ids(result.rows), ['a', 'z']);
  assert.deepEqual(input, before);
  const empty = projectWorkCalendar(input, '', 'Asia/Shanghai');
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.minutes, 0);
  assert.deepEqual(ids(empty.unknown), ['unknown']);
  assert.deepEqual(input, before);
});
