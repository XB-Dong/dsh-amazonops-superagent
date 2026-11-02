import { createTaskRecord } from './task-record.ts';
import { Store, type Base } from '../core/store.ts';
import { zonedInstant } from './time.ts';
import type { Task } from './task-types.ts';
export type Activity = Base & {
  title: string;
  store: string;
  listing: string;
  timeZone: string;
  startAt: string;
  endAt: string;
  leadHours: number;
  offerNote: string;
  status: string;
  sources: string[];
  stages: { name: string; dueAt: string; taskId: string }[];
};
export class Activities {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  create(
    scope: string,
    key: string,
    data: Omit<Activity, keyof Base | 'sources' | 'stages' | 'status'>,
  ): Activity {
    const start = zonedInstant(data.startAt, data.timeZone),
      end = zonedInstant(data.endAt, data.timeZone);
    if (
      end <= start + 900000 ||
      !Number.isFinite(data.leadHours) ||
      data.leadHours < 0 ||
      data.leadHours > 168 ||
      !data.title.trim() ||
      !data.store.trim() ||
      !data.listing.trim()
    )
      throw new Error('INVALID_ACTIVITY');
    return this.store.once(scope, `activity:${key}`, () => {
      const source = this.store.source(scope, JSON.stringify(data));
      const stages = [
        ['准备', start - data.leadHours * 3600000],
        ['开始切换', start],
        ['检查生效', start + 900000],
        ['结束恢复', end],
      ] as const;
      const tasks = stages.map(([name, time]) => {
        const dueAt = new Date(time).toISOString();
        const task = createTaskRecord(this.store, scope, {
          title: `${data.title} · ${name}`, timeZone: data.timeZone, schedule: { dueAt },
          confirmed: true, checklist: [`${name}：人工核对 ${data.store} / ${data.listing}`, '核对新旧优惠、记录实际结果'],
          sources: [source.id],
        });
        return { name, dueAt, taskId: task.id };
      });
      return this.store.create(scope, 'activity', {
        ...data,
        status: 'planned',
        sources: [source.id],
        stages: tasks,
      });
    });
  }
  tick(scope: string, at = Date.now()): void {
    for (const activity of this.store.list<Activity>(scope, 'activity')) {
      if (activity.status === 'cancelled') continue;
      for (const stage of activity.stages) {
        const task = this.store.get<Task>(scope, stage.taskId);
        if (Date.parse(stage.dueAt) > at || ['cancelled', 'done'].includes(task.status)) continue;
        this.store.once(scope, `reminder:${activity.id}:${stage.name}`, () =>
          this.store.create(scope, 'reminder', {
            activityId: activity.id,
            taskId: stage.taskId,
            title: `${activity.title} · ${stage.name}`,
            dueAt: stage.dueAt,
            timeZone: activity.timeZone,
            read: false,
            sources: activity.sources,
          }),
        );
      }
    }
  }
  cancel(scope: string, id: string, revision: number): Activity {
    return this.store.transaction(() => {
      const row = this.store.get<Activity>(scope, id);
      if (row.kind !== 'activity') throw new Error('INVALID_ACTIVITY');
      const cancelled = this.store.update(row, { status: 'cancelled' }, revision);
      for (const stage of row.stages) {
        const task = this.store.get<Task>(scope, stage.taskId);
        if (!['done', 'cancelled'].includes(task.status))
          this.store.update(task, { status: 'cancelled' });
      }
      return cancelled;
    });
  }
}
