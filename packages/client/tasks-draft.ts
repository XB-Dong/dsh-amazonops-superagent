import type { Task } from '../contracts/model.ts';

export type MinutesDraft = { initialTaskSnapshot: Task; value: string };
export type MinutesDrafts = Readonly<Record<string, MinutesDraft>>;

export function openMinutesDraft(drafts: MinutesDrafts, task: Task): MinutesDrafts {
  if (drafts[task.id]) return drafts;
  return { ...drafts, [task.id]: { initialTaskSnapshot: structuredClone(task), value: task.actualMinutes?.toString() ?? '' } };
}
export function changeMinutesDraft(drafts: MinutesDrafts, id: string, value: string): MinutesDrafts {
  const draft = drafts[id];
  return draft ? { ...drafts, [id]: { ...draft, value } } : drafts;
}
export function closeMinutesDraft(drafts: MinutesDrafts, id: string): MinutesDrafts {
  const next = { ...drafts }; delete next[id]; return next;
}
export function minutesUpdate(draft: MinutesDraft, completion = false) {
  const actualMinutes = draft.value === '' ? null : Number(draft.value);
  if (actualMinutes !== null && (!Number.isInteger(actualMinutes) || actualMinutes < 0 || actualMinutes > 1440)) {
    throw new Error('实际用时请填写 0 到 1440 之间的整数分钟。');
  }
  return { id: draft.initialTaskSnapshot.id, revision: draft.initialTaskSnapshot.revision, actualMinutes,
    ...(completion ? { status: 'done', confirmedSuccess: true } : {}) };
}
