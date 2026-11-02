import { useState } from 'react';
import type { Snapshot } from './api.ts';
import type { Task } from '../contracts/model.ts';
import type { Mutate } from './TasksPage.tsx';
import { ActualMinutesForm } from './TaskForm.tsx';
import { Empty } from './components.tsx';
import { timeZones, timeZoneLabel } from './display.ts';
import { calendarDay, plannedLabel } from './task-time.ts';
import { projectWorkCalendar } from './work-calendar.ts';
import './p41-tasks.css';

export function WorkCalendarPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [zone, setZone] = useState('Asia/Shanghai');
  const [date, setDate] = useState(
    () => calendarDay(new Date().toISOString(), 'Asia/Shanghai') ?? '',
  );
  const { rows, unknown, recorded, minutes } = projectWorkCalendar(data.tasks, date, zone);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">看看每天做了什么</span>
          <h1>工作日历</h1>
          <p>完成的任务会自动出现在这里，实际用时由你填写。</p>
        </div>
      </div>
      <section className="panel">
        <div className="p41-calendar-controls">
          <label>
            查看日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            日历时区
            <select value={zone} onChange={(event) => setZone(event.target.value)}>
              {Object.entries(timeZones).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="metadata">
          按完成日期归入所选时区当天；跨午夜的任务记在完成当天。每条任务的计划仍按它原来的时区显示。
        </p>
        <p className="p41-calendar-summary" aria-live="polite">
          当天完成 {rows.length} 项 · 已记录实际用时 {minutes} 分钟 ·{' '}
          {rows.length - recorded.length} 项用时未记录
        </p>
        <p className="metadata">未记录的用时不按零计入；计划起止时间不会自动计入实际用时。</p>
      </section>
      {!rows.length ? (
        <section className="panel p41-history">
          <Empty
            title={date ? '这一天还没有完成记录' : '请选择查看日期'}
            text="在任务清单确认完成后，记录会自动显示在对应日期。"
            icon="calendar"
          />
        </section>
      ) : (
        <div className="card-list p41-history">
          {rows.map((task) => (
            <CalendarRecord key={task.id} task={task} zone={zone} mutate={mutate} busy={busy} />
          ))}
        </div>
      )}
      {unknown.length > 0 && (
        <details className="panel p41-history">
          <summary>历史完成记录，日期未记录（{unknown.length} 项）</summary>
          <p className="metadata">这些旧任务没有记录完成日期，未计入任一天的统计。</p>
          <div className="card-list">
            {unknown.map((task) => (
              <CalendarRecord key={task.id} task={task} zone={zone} mutate={mutate} busy={busy} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
function CalendarRecord({
  task,
  zone,
  mutate,
  busy,
}: {
  task: Task;
  zone: string;
  mutate: Mutate;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="panel">
      <h2>{task.title}</h2>
      <p className="metadata">
        {calendarDay(task.completedAt, zone)
          ? `完成时间：${new Date(task.completedAt!).toLocaleString('zh-CN', { timeZone: zone, hour12: false })}（${timeZoneLabel(zone)}）`
          : '完成日期未记录'}
      </p>
      <p className="metadata">
        计划：{plannedLabel(task)}（{timeZoneLabel(task.timeZone)}）
      </p>
      <p>实际用时：{task.actualMinutes == null ? '未记录' : `${task.actualMinutes} 分钟`}</p>
      <button className="text-button" disabled={busy} onClick={() => setEditing(!editing)}>
        补记或修改实际用时
      </button>
      {editing && (
        <ActualMinutesForm
          task={task}
          mutate={mutate}
          busy={busy}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
    </article>
  );
}
