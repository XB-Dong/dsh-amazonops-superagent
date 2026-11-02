import { useState, type FormEvent } from 'react';
import { requestId, type Snapshot } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import { Badge, Empty, Icon } from './components.tsx';
import { timeZones, timeZoneLabel } from './display.ts';

export function ActivitiesPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [form, setForm] = useState(false);
  const [confirm, setConfirm] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await mutate('activity', {
      ...values,
      leadHours: Number(values.leadHours),
      requestId: requestId(),
    });
    setForm(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">记好时间，逐步跟进</span>
          <h1>活动日历</h1>
          <p>按站点时间准备、切换、检查和恢复。平台操作由你确认。</p>
        </div>
        <button className="primary" onClick={() => setForm(!form)}>
          <Icon name="plus" size={17} />
          安排活动
        </button>
      </div>
      {data.reminders
        .filter((r) => !r.read)
        .map((r) => (
          <section className="panel" key={r.id}>
            <Badge>到期提醒</Badge>
            <h3>{r.title}</h3>
            <p>
              {new Date(r.dueAt).toLocaleString('zh-CN', { timeZone: r.timeZone })} ·{' '}
              {timeZoneLabel(r.timeZone)}
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void mutate('reminder-read', { id: r.id, revision: r.revision }).catch(() => {})
              }
            >
              我已看到
            </button>
          </section>
        ))}
      {form && (
        <form className="panel form-grid" onSubmit={(e) => void submit(e).catch(() => {})}>
          <label className="wide">
            活动名称
            <input name="title" required maxLength={200} />
          </label>
          <label>
            店铺
            <input name="store" required maxLength={100} />
          </label>
          <label>
            链接或商品编码
            <input name="listing" required maxLength={100} />
          </label>
          <label>
            站点时区
            <select name="timeZone" defaultValue="America/Los_Angeles">
              {Object.entries(timeZones).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            准备提前小时
            <input
              name="leadHours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              defaultValue="4"
              required
            />
            <small>可配置的工作经验，非平台通则</small>
          </label>
          <label>
            站点开始时刻（含偏移）
            <input name="startAt" placeholder="2026-10-26T10:00:00-07:00" required />
          </label>
          <label>
            站点结束时刻（含偏移）
            <input name="endAt" placeholder="2026-10-27T10:00:00-07:00" required />
          </label>
          <label className="wide">
            优惠说明
            <textarea
              name="offerNote"
              placeholder="记录价格、优惠类型、需关闭的旧优惠；不推定叠加公式"
              maxLength={1000}
            />
          </label>
          <div className="form-actions wide">
            <button type="button" onClick={() => setForm(false)}>
              取消
            </button>
            <button className="primary" disabled={busy}>
              保存并生成四阶段任务
            </button>
          </div>
        </form>
      )}
      {!data.activities.length && (
        <section className="panel">
          <Empty
            icon="calendar"
            title="把下一次活动安排好"
            text="时间、优惠和每一步的检查集中在一起。提醒显示在工作台内，不会发送外部通知。"
          />
        </section>
      )}
      {data.activities.map((a) => (
        <section className="panel" key={a.id}>
          <div className="page-heading">
            <div>
              <h2>{a.title}</h2>
              <p>
                {a.store} · {a.listing} · {timeZoneLabel(a.timeZone)}
              </p>
            </div>
            <Badge>
              {{
                planned: '已排内部计划',
                active: '人工确认已生效',
                restored: '人工确认已恢复',
                cancelled: '已取消',
              }[a.status] ?? a.status}
            </Badge>
          </div>
          <p>
            {new Date(a.startAt).toLocaleString('zh-CN', { timeZone: a.timeZone })} →{' '}
            {new Date(a.endAt).toLocaleString('zh-CN', { timeZone: a.timeZone })}
          </p>
          <p>{a.offerNote || '未填写优惠说明'}</p>
          <div className="activity-stages">
            {a.stages.map((s) => (
              <div key={s.name}>
                <strong>{s.name}</strong>
                <p>{new Date(s.dueAt).toLocaleString('zh-CN', { timeZone: a.timeZone })}</p>
                <small>
                  {data.tasks.find((t) => t.id === s.taskId)?.status === 'done'
                    ? '已完成检查'
                    : '见任务清单'}
                </small>
              </div>
            ))}
          </div>
          {['planned', 'active'].includes(a.status) && (
            <div className="form-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void mutate('activity-cancel', { id: a.id, revision: a.revision }).catch(() => {})
                }
              >
                取消活动计划
              </button>
              <button onClick={() => setConfirm(a.id)}>
                记录{a.status === 'planned' ? '已生效' : '已恢复'}
              </button>
            </div>
          )}
          {confirm === a.id && (
            <div className="confirmation-box">
              <p>请先在平台核对实际结果。此记录不会执行改价或调整优惠。</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void mutate('activity-observe', {
                    id: a.id,
                    revision: a.revision,
                    status: a.status === 'planned' ? 'active' : 'restored',
                    confirmed: true,
                  })
                    .then(() => setConfirm(undefined))
                    .catch(() => {})
                }
              >
                我已核实，确认记录
              </button>
              <button onClick={() => setConfirm(undefined)}>返回</button>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
