import { useState } from 'react';
import type { Task } from '../contracts/model.ts';
import type { Snapshot } from './api.ts';
import { Badge, Empty, Icon, SourceList, states } from './components.tsx';
import { TaskForm, ActualMinutesForm } from './TaskForm.tsx';
import { plannedLabel } from './task-time.ts';
import { taskListGroups, listTimeZone } from './task-list-view.ts';
import { TaskCopyForm } from './TaskCopyForm.tsx';
import './p43-tasks.css';
import './p41-tasks.css';
import './p42-tasks.css';

export type Mutate = (action: string, body: object) => Promise<unknown>;
export function TasksPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [editor, setEditor] = useState<{ task?: Task } | null>(null);
  const [filter, setFilter] = useState('active');
  const [selectedDate, setSelectedDate] = useState('');
  const [copyTask, setCopyTask] = useState<Task | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const rows = data.tasks.filter(
    (row) => filter === 'all' || !['done', 'cancelled'].includes(row.status),
  );
  const groups = taskListGroups(data.tasks, filter, selectedDate);
  const visibleCount = groups.reduce((count, group) => count + group.tasks.length, 0);
  const editorOpen = !!editor || !!copyTask;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">把事情记清楚</span>
          <h1>任务清单</h1>
          <p>准备、确认、检查，也可以随时调整待办。</p>
        </div>
        <button className="primary" disabled={busy || editorOpen} onClick={() => setEditor({})}>
          <Icon name="plus" size={17} /> 新建任务
        </button>
      </div>
      {editor && (
        <TaskForm
          key={editor.task?.id ?? 'new'}
          task={editor.task}
          mutate={mutate}
          busy={busy}
          onClose={() => setEditor(null)}
        />
      )}
      {copyTask && (
        <TaskCopyForm
          key={copyTask.id}
          task={copyTask}
          mutate={mutate}
          busy={busy}
          onClose={() => setCopyTask(null)}
          onCopied={() => {
            setCopyTask(null);
            setSelectedDate('');
            setFilter('active');
            setCopyNotice('已复制成新草稿。请找到新任务，核对后点“确认这份任务”。');
          }}
        />
      )}
      {copyNotice && (
        <p className="panel" role="status">
          {copyNotice}
        </p>
      )}
      <section className="panel p42-group-controls" aria-label="任务创建日期归组">
        <div>
          <strong>按创建日期归组 · 北京时间</strong>
          <p className="metadata" id="task-grouping-description">
            本页日期和计划、完成时间统一按北京时间显示。编辑或完成任务不会改变创建日期；排期编辑仍使用任务原时区。
          </p>
        </div>
        <div className="p43-date-controls">
          <label>
            创建日期
            <input
              type="date"
              aria-describedby="task-grouping-description"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!selectedDate}
            onClick={() => setSelectedDate('')}
          >
            全部日期
          </button>
        </div>
      </section>
      <div className="tabs">
        <button
          className={filter === 'active' ? 'selected' : ''}
          onClick={() => setFilter('active')}
        >
          待处理
        </button>
        <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
          全部记录
        </button>
        <span>{visibleCount} 个任务</span>
      </div>
      {!rows.length && !selectedDate ? (
        <section className="panel">
          <Empty
            title="这里还没有任务"
            text="点“新建任务”，或者让助手先拟一份准备清单。"
            icon="tasks"
          />
        </section>
      ) : (
        <div className="card-list p42-task-list">
          {groups.flatMap((group) => [
            <div className="p42-date-heading" key={`date-${group.date ?? 'unknown'}`}>
              <h2>{group.date ? `${group.date} 创建` : '创建日期未记录'}</h2>
              <span>{group.tasks.length} 个任务</span>
            </div>,
            ...(group.tasks.length
              ? []
              : [
                  <section className="panel" key={`empty-${group.date}`}>
                    <Empty
                      title="这一天没有符合条件的任务"
                      text="可以切换日期、查看全部记录，或新建任务。"
                      icon="tasks"
                    />
                  </section>,
                ]),
            ...group.tasks.map((task) => (
              <TaskCard
                key={`task-${task.id}`}
                task={task}
                mutate={mutate}
                busy={busy}
                editDisabled={editorOpen}
                onEdit={() => setEditor({ task })}
                onCopy={() => {
                  setCopyNotice('');
                  setCopyTask(task);
                }}
              />
            )),
          ])}
        </div>
      )}
    </>
  );
}
function TaskCard({
  task,
  mutate,
  busy,
  editDisabled,
  onEdit,
  onCopy,
}: {
  task: Task;
  mutate: Mutate;
  busy: boolean;
  editDisabled: boolean;
  onEdit: () => void;
  onCopy: () => void;
}) {
  const [minutesOpen, setMinutesOpen] = useState(false);
  const active = !['done', 'cancelled'].includes(task.status);
  return (
    <article className="panel task-card">
      <div className="card-heading">
        <h2>{task.title}</h2>
        <Badge tone={task.status === 'done' ? 'green' : ''}>{states[task.status]}</Badge>
      </div>
      <p className="metadata">北京时间 · {plannedLabel({ ...task, timeZone: listTimeZone })}</p>
      {task.status === 'done' && (
        <p className="metadata">
          {task.completedAt
            ? `完成于 ${new Date(task.completedAt).toLocaleString('zh-CN', { timeZone: listTimeZone, hour12: false })}`
            : '历史完成记录，日期未记录'}{' '}
          · 实际用时：{task.actualMinutes == null ? '未记录' : `${task.actualMinutes} 分钟`}
        </p>
      )}
      <div className="checklist">
        {task.checklist.map((text, index) => (
          <label key={index}>
            <input
              type="checkbox"
              checked={task.checked[index]}
              disabled={busy || !active || task.status === 'draft'}
              onChange={() => {
                const checked = [...task.checked];
                checked[index] = !checked[index];
                void mutate('task-update', { id: task.id, revision: task.revision, checked }).catch(
                  () => {},
                );
              }}
            />
            <span>{text}</span>
          </label>
        ))}
      </div>
      <div className="card-footer">
        <SourceList sources={task.sources} />
        <div className="p41-actions">
          <button className="secondary small" disabled={busy || editDisabled} onClick={onCopy}>
            复制为新任务
          </button>
          {active && (
            <button className="secondary small" disabled={busy || editDisabled} onClick={onEdit}>
              编辑任务
            </button>
          )}
          {task.status === 'draft' ? (
            <button
              className="primary small"
              disabled={busy}
              onClick={() =>
                void mutate('task-update', {
                  id: task.id,
                  revision: task.revision,
                  status: 'open',
                }).catch(() => {})
              }
            >
              确认这份任务
            </button>
          ) : (
            active && (
              <button
                className="secondary small"
                disabled={busy || !task.checked.every(Boolean)}
                onClick={() => setMinutesOpen(true)}
              >
                记录完成
              </button>
            )
          )}
          {task.status === 'done' && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setMinutesOpen(!minutesOpen)}
            >
              补记或修改实际用时
            </button>
          )}
          {active && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate('task-update', {
                  id: task.id,
                  revision: task.revision,
                  status: 'cancelled',
                }).catch(() => {})
              }
            >
              取消任务
            </button>
          )}
        </div>
      </div>
      {minutesOpen && (task.status === 'done' || (active && task.status !== 'draft')) && (
        <ActualMinutesForm
          task={task}
          mutate={mutate}
          busy={busy || (active && !task.checked.every(Boolean))}
          completion={task.status !== 'done'}
          onSaved={() => setMinutesOpen(false)}
          onCancel={() => setMinutesOpen(false)}
        />
      )}
    </article>
  );
}
