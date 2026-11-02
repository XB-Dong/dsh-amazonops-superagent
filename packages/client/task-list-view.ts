import { groupTasksByCreatedDate } from './task-groups.ts';
import type { Task } from '../contracts/model.ts';
export const listTimeZone = 'Asia/Shanghai';
export function taskListGroups<T extends { id: string; createdAt?: string; status: string }>(
  tasks: readonly T[],
  filter: string,
  date: string,
) {
  const groups = groupTasksByCreatedDate(
    tasks.filter((task) => filter === 'all' || !['done', 'cancelled'].includes(task.status)),
    listTimeZone,
  );
  if (!date) return groups;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error('请选择有效的日期。');
  return [groups.find((group) => group.date === date) ?? { date, tasks: [] }];
}
export function copyPreview(
  task: Pick<Task, 'title' | 'checklist'>,
  title: string,
  from: string,
  to: string,
) {
  if ((from || to) && (!from.trim() || !to.trim()))
    throw new Error('原标识和新标识需要同时填写有效内容，或同时留空。');
  if (from.length > 100 || to.length > 100) throw new Error('替换标识最多 100 字。');
  const replace = (text: string) => (from ? text.split(from).join(to) : text);
  const result = {
    title: replace(title || task.title).trim(),
    checklist: task.checklist.map(replace),
  };
  if (!result.title.trim() || result.title.length > 200)
    throw new Error('新任务标题需要 1 到 200 字。');
  if (
    !result.checklist.length ||
    result.checklist.length > 30 ||
    result.checklist.some((text) => !text.trim() || text.length > 300)
  )
    throw new Error('清单需要 1 到 30 项，每项最多 300 字；请缩短替换后的内容。');
  return result;
}
