import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTasksByCreatedDate } from '../../packages/client/task-groups.ts';

test('creation date follows selected viewing timezone across UTC midnight', () => {
  const tasks = [
    { id: 'a', createdAt: '2026-10-27T17:30:00Z' },
    { id: 'b', createdAt: '2026-10-27T01:00:00Z' },
  ];
  assert.deepEqual(
    groupTasksByCreatedDate(tasks, 'Asia/Shanghai').map((group) => [
      group.date,
      group.tasks.map((task) => task.id),
    ]),
    [
      ['2026-10-28', ['a']],
      ['2026-10-27', ['b']],
    ],
  );
  assert.deepEqual(
    groupTasksByCreatedDate(tasks, 'America/Los_Angeles').map((group) => [
      group.date,
      group.tasks.map((task) => task.id),
    ]),
    [
      ['2026-10-27', ['a']],
      ['2026-10-26', ['b']],
    ],
  );
});

test('Rome grouping uses winter and summer offsets rather than a fixed offset', () => {
  const tasks = [
    { id: 'winter', createdAt: '2026-01-01T22:30:00Z' },
    { id: 'summer', createdAt: '2026-07-01T22:30:00Z' },
    { id: 'fold-before', createdAt: '2026-10-25T00:30:00Z' },
    { id: 'fold-after', createdAt: '2026-10-25T01:30:00Z' },
  ];
  assert.deepEqual(
    groupTasksByCreatedDate(tasks, 'Europe/Rome').map((group) => [
      group.date,
      group.tasks.map((task) => task.id),
    ]),
    [
      ['2026-10-25', ['fold-after', 'fold-before']],
      ['2026-07-02', ['summer']],
      ['2026-01-01', ['winter']],
    ],
  );
});

test('editing, planning and later completion do not move creation-date ownership', () => {
  const tasks = [
    {
      id: 'a',
      createdAt: '2026-10-26T16:30:00Z',
      updatedAt: '2026-10-30T01:00:00Z',
      dueAt: '2026-11-01T10:00:00+01:00',
      completedAt: '2026-10-29T17:30:00Z',
      status: 'done',
      title: 'Edited',
    },
  ];
  const groups = groupTasksByCreatedDate(tasks, 'Asia/Shanghai');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, '2026-10-27');
  assert.equal(groups[0].tasks[0], tasks[0]);
});

test('group order and within-day order use instants, with stable IDs on ties', () => {
  const tasks = [
    { id: 'older', createdAt: '2026-10-28T10:00:00+08:00' },
    { id: 'b-tie', createdAt: '2026-10-28T03:00:00Z' },
    { id: 'a-tie', createdAt: '2026-10-28T11:00:00+08:00' },
    { id: 'newest-day', createdAt: '2026-10-29T00:00:00Z' },
  ];
  assert.deepEqual(
    groupTasksByCreatedDate(tasks, 'Asia/Shanghai').map((group) => [
      group.date,
      group.tasks.map((task) => task.id),
    ]),
    [
      ['2026-10-29', ['newest-day']],
      ['2026-10-28', ['a-tie', 'b-tie', 'older']],
    ],
  );
});

test('unknown or malformed creation dates stay visible in one final group without guessing', () => {
  const tasks = [
    { id: 'missing', updatedAt: '2026-10-28T12:00:00Z' },
    { id: 'invalid', createdAt: 'not-a-date' },
    { id: 'date-only', createdAt: '2026-10-28' },
    { id: 'no-offset', createdAt: '2026-10-28T12:00:00' },
    { id: 'invalid-clock', createdAt: '2026-10-28T24:00:00Z' },
    { id: 'impossible', createdAt: '2026-02-30T10:00:00Z' },
    { id: 'valid', createdAt: '2026-10-27T18:00:00Z' },
  ];
  const groups = groupTasksByCreatedDate(tasks, 'Asia/Shanghai');
  assert.equal(groups[0].date, '2026-10-28');
  assert.equal(groups[1].date, null);
  assert.deepEqual(
    groups[1].tasks.map((task) => task.id),
    ['date-only', 'impossible', 'invalid', 'invalid-clock', 'missing', 'no-offset'],
  );
  assert.equal(groups.flatMap((group) => group.tasks).length, tasks.length);
});

test('grouping accepts empty input and never mutates the source array or task objects', () => {
  assert.deepEqual(groupTasksByCreatedDate([], 'Asia/Shanghai'), []);
  const a = Object.freeze({ id: 'a', createdAt: '2026-10-27T10:00:00Z' });
  const b = Object.freeze({ id: 'b', createdAt: '2026-10-28T10:00:00Z' });
  const tasks = Object.freeze([a, b]);
  const groups = groupTasksByCreatedDate(tasks, 'Asia/Shanghai');
  assert.deepEqual(tasks, [a, b]);
  assert.equal(groups[0].tasks[0], b);
  assert.equal(groups[1].tasks[0], a);
});
