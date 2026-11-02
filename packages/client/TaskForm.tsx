import { useId, useState, type FormEvent } from 'react';
import type { Task } from '../contracts/model.ts';
import { requestId } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import { timeZones } from './display.ts';
import { localFields, scheduleChanges, timeOptions } from './task-time.ts';
import './p41-tasks.css';

type Schedule = { date: string; time: string };
function ScheduleField({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: Schedule;
  onChange: (value: Schedule) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="p41-schedule" disabled={disabled}>
      <legend>{name}（可选）</legend>
      <label>
        {name}日期
        <input
          type="date"
          value={value.date}
          onChange={(event) => onChange({ ...value, date: event.target.value })}
        />
      </label>
      <label>
        {name}时间
        <select
          value={value.time}
          onChange={(event) => onChange({ ...value, time: event.target.value })}
        >
          <option value="">请选择时间</option>
          {timeOptions(value.time).map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="text-button"
        onClick={() => onChange({ date: '', time: '' })}
      >
        清除{name}
      </button>
    </fieldset>
  );
}
export function TaskForm({
  task,
  mutate,
  busy,
  onClose,
}: {
  task?: Task;
  mutate: Mutate;
  busy: boolean;
  onClose: () => void;
}) {
  const [initial] = useState(task);
  const [key, setKey] = useState(requestId);
  const [title, setTitle] = useState(task?.title ?? '');
  const [checklist, setChecklist] = useState(task?.checklist.join('\n') ?? '');
  const [zone, setZone] = useState(task?.timeZone ?? '');
  const [start, setStart] = useState(() =>
    localFields(task?.startAt, task?.timeZone ?? 'Asia/Shanghai'),
  );
  const [end, setEnd] = useState(() =>
    localFields(task?.endAt ?? task?.dueAt, task?.timeZone ?? 'Asia/Shanghai'),
  );
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [error, setError] = useState('');
  const zoneChanged = !!initial && zone !== initial.timeZone;
  const needsConfirmation = zoneChanged && !!(initial.startAt || initial.endAt || initial.dueAt);
  function changedDraft() {
    if (!initial) setKey(requestId());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      if (needsConfirmation && !zoneConfirmed) throw new Error('请先确认修改时区后的计划时间。');
      const body: Record<string, unknown> = {
        title,
        checklist: checklist
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        timeZone: zone,
      };
      Object.assign(body, scheduleChanges(initial, zone, start, end));
      await mutate(
        initial ? 'task-update' : 'task',
        initial
          ? { ...body, id: initial.id, revision: initial.revision }
          : { ...body, requestId: key },
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存未完成，请重试。');
    }
  }
  return (
    <form
      className="panel form-grid p41-task-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2 className="wide">{initial ? '编辑任务' : '新建任务'}</h2>
      <label className="wide">
        任务名称
        <input
          value={title}
          disabled={busy}
          onChange={(event) => {
            setTitle(event.target.value);
            changedDraft();
          }}
          required
          maxLength={200}
          placeholder="例如：整理本周广告数据"
        />
      </label>
      <label className="wide">
        任务时区
        <select
          value={zone}
          disabled={busy}
          required
          onChange={(event) => {
            setZone(event.target.value);
            changedDraft();
            setZoneConfirmed(false);
          }}
        >
          <option value="" disabled>
            请选择任务使用的当地时间
          </option>
          {initial && !(initial.timeZone in timeZones) && (
            <option value={initial.timeZone}>{initial.timeZone}（原时区）</option>
          )}
          {Object.entries(timeZones).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="metadata wide">以下日期和时间均按所选任务时区填写。计划时间不等于实际用时。</p>
      <ScheduleField
        name="计划开始"
        value={start}
        onChange={(value) => {
          setStart(value);
          if (value.date !== start.date || value.time !== start.time) changedDraft();
        }}
        disabled={busy}
      />
      <ScheduleField
        name="计划结束"
        value={end}
        onChange={(value) => {
          setEnd(value);
          if (value.date !== end.date || value.time !== end.time) changedDraft();
        }}
        disabled={busy}
      />
      {needsConfirmation && (
        <label className="wide p41-confirm">
          <input
            type="checkbox"
            checked={zoneConfirmed}
            disabled={busy}
            onChange={(event) => setZoneConfirmed(event.target.checked)}
          />
          我已核对：上方计划时间将按新时区重新保存，实际时刻可能改变。
        </label>
      )}
      <label className="wide">
        检查清单（每行一项）
        <textarea
          rows={4}
          value={checklist}
          disabled={busy}
          onChange={(event) => {
            setChecklist(event.target.value);
            changedDraft();
          }}
          required
          placeholder={'检查活动信息\n核对最终结果'}
        />
      </label>
      {initial && (
        <p className="metadata wide">修改过的检查项需要重新勾选。未修改的计划时间会原样保留。</p>
      )}
      {error && (
        <p className="p41-error wide" role="alert">
          {error}
        </p>
      )}
      <div className="wide form-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>
          取消编辑
        </button>
        <button className="primary" disabled={busy}>
          {initial ? '保存修改' : '确认并保存'}
        </button>
      </div>
    </form>
  );
}
export function ActualMinutesForm({
  task,
  mutate,
  busy,
  completion = false,
  onSaved,
  onCancel,
}: {
  task: Task;
  mutate: Mutate;
  busy: boolean;
  completion?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [initial] = useState(task);
  const [value, setValue] = useState(task.actualMinutes?.toString() ?? '');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      const actualMinutes = value === '' ? null : Number(value);
      if (
        actualMinutes !== null &&
        (!Number.isInteger(actualMinutes) || actualMinutes < 0 || actualMinutes > 1440)
      )
        throw new Error('实际用时请填写 0 到 1440 之间的整数分钟。');
      await mutate('task-update', {
        id: initial.id,
        revision: initial.revision,
        actualMinutes,
        ...(completion ? { status: 'done', confirmedSuccess: true } : {}),
      });
      onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存未完成，请重试。');
    }
  }
  return (
    <form
      className="p41-minutes"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label htmlFor={id}>
        实际用时（分钟，可留空）
        <input
          id={id}
          type="number"
          min={0}
          max={1440}
          step={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          placeholder="未记录"
        />
      </label>
      <p className="metadata">按实际工作填写；留空记为“未记录”，不会按计划时间估算。</p>
      {error && (
        <p className="p41-error" role="alert">
          {error}
        </p>
      )}
      <div className="p41-actions">
        <button className="primary small" disabled={busy}>
          {completion ? '确认完成并保存经验' : '保存实际用时'}
        </button>
        {onCancel && (
          <button type="button" className="text-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        )}
      </div>
    </form>
  );
}
