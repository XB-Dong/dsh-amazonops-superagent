import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../packages/contracts/model.ts';
import { openMinutesDraft, changeMinutesDraft, closeMinutesDraft, minutesUpdate } from '../../packages/client/tasks-draft.ts';
import { taskListGroups } from '../../packages/client/task-list-view.ts';

const task: Task = { id: 'done-task', scope: 'main', kind: 'task', revision: 3,
  createdAt: '2026-11-02T01:00:00Z', updatedAt: '2026-11-02T02:00:00Z',
  title: 'Synthetic completed task', checklist: ['Check result'], checked: [true],
  status: 'done', timeZone: 'Asia/Shanghai', sources: [], actualMinutes: null, confirmedSuccess: true };

test('unsaved minutes survive status/date card removal, reopening and refreshed task revisions', () => {
  let drafts = openMinutesDraft({}, task);
  drafts = changeMinutesDraft(drafts, task.id, '37');
  assert.equal(taskListGroups([task], 'active', '').flatMap(group => group.tasks).length, 0);
  assert.equal(taskListGroups([task], 'all', '2026-11-01').flatMap(group => group.tasks).length, 0);
  assert.equal(taskListGroups([task], 'all', '').flatMap(group => group.tasks).length, 1);
  drafts = openMinutesDraft(drafts, { ...task, revision: 4, actualMinutes: 99 });
  assert.equal(drafts[task.id].value, '37');
  assert.deepEqual(minutesUpdate(drafts[task.id]), { id: task.id, revision: 3, actualMinutes: 37 });
  assert.equal(drafts[task.id].initialTaskSnapshot.status, 'done');
});

test('drafts retain independent detached snapshots and clear only the explicitly closed task', () => {
  const original = structuredClone(task);
  let drafts = openMinutesDraft({}, original);
  original.checked[0] = false; original.revision = 100;
  drafts = changeMinutesDraft(drafts, task.id, '37');
  const second = { ...task, id: 'second-task', revision: 7 };
  drafts = openMinutesDraft(drafts, second);
  drafts = changeMinutesDraft(drafts, second.id, '12');
  assert.deepEqual(drafts[task.id].initialTaskSnapshot.checked, [true]);
  assert.equal(drafts[task.id].initialTaskSnapshot.revision, 3);
  drafts = closeMinutesDraft(drafts, second.id);
  assert.equal(drafts[second.id], undefined);
  assert.equal(drafts[task.id].value, '37');
  drafts = closeMinutesDraft(drafts, task.id);
  assert.deepEqual(drafts, {});
  drafts = openMinutesDraft(drafts, { ...task, revision: 4, actualMinutes: 45 });
  assert.equal(drafts[task.id].value, '45');
  assert.equal(minutesUpdate(drafts[task.id]).revision, 4);
});

test('minute commands preserve completion semantics and forbid unrelated completed-task edits', () => {
  const draft = openMinutesDraft({}, task)[task.id];
  assert.deepEqual(minutesUpdate(draft), { id: task.id, revision: 3, actualMinutes: null });
  assert.deepEqual(minutesUpdate({ ...draft, value: '0' }, true), {
    id: task.id, revision: 3, actualMinutes: 0, status: 'done', confirmedSuccess: true,
  });
  for (const value of ['-1', '1441', '3.5', 'invalid']) assert.throws(() => minutesUpdate({ ...draft, value }));
  assert.deepEqual(Object.keys(minutesUpdate({ ...draft, value: '37' })).sort(), ['actualMinutes', 'id', 'revision']);
});
