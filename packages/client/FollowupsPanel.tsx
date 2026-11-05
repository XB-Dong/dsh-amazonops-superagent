import { useState, type FormEvent } from 'react';
import type { FollowupSnapshot } from '../contracts/followups.ts';
import { canChat, requestId, type Snapshot, type Status } from './api.ts';
import { stableFormIntent, type AssistantDraftState, type SetAssistantDrafts } from './assistant-state.ts';
import { watchExpiry } from './work.ts';

type Assessment = { eventId: string; decision: 'would_accept' | 'accepted' | 'ignored' | 'unavailable' | 'pending'; reason: string; at?: string; ticketId?: string };
export type FollowupView = FollowupSnapshot & { autoAvailable?: boolean; autoBlockedReason?: string; assessments?: Assessment[] };
const watchLabels = { active: '持续跟进中', stopped: '已停止', expired: '已到期', completed: '已完成' };
const ruleLabels = { off: '关闭规则', observe: '观察模式', auto: '自动复核' };
export function FollowupsPanel({ data, status, followups, drafts, setDrafts, busy, perform, reportError }: {
  data: Snapshot; status?: Status; followups?: FollowupView; drafts: AssistantDraftState; setDrafts: SetAssistantDrafts;
  busy: boolean; perform: (path: string, body: object) => Promise<boolean>; reportError: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rule = drafts.rule ?? { mode: followups?.rule?.mode ?? 'observe', inventoryIds: followups?.rule?.inventoryIds ?? [] };
  async function submit(path: string, body: object, key: string) {
    const intent = stableFormIntent(drafts.intents[key], body, requestId);
    setDrafts(current => ({ ...current, intents: { ...current.intents, [key]: intent } }));
    return perform(path, { ...body, requestId: intent.requestId });
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const submitted = { ...drafts.watch };
      if (!data.inventories.some(item => item.id === drafts.watch.inventoryId)) throw new Error('请明确选择一个现有库存方案。');
      const body = { inventoryId: drafts.watch.inventoryId, expiresAt: watchExpiry(drafts.watch.expiresLocal),
        ...(drafts.watch.title.trim() ? { title: drafts.watch.title.trim() } : {}) };
      if (await submit('followups/create', body, 'watch-create')) {
        setDrafts(current => ({ ...current, watch: JSON.stringify(current.watch) === JSON.stringify(submitted) ? { inventoryId: '', expiresLocal: '', title: '' } : current.watch,
          intents: Object.fromEntries(Object.entries(current.intents).filter(([key]) => key !== 'watch-create')) }));
        setExpanded(false);
      }
    } catch (error) { reportError(error instanceof Error ? error.message : '跟进尚未建立，请核对填写内容。'); }
  }
  const choices = data.inventories.map(item => ({ id: item.id, label: `${item.store} · ${item.site} · ${item.listing} · ${item.asOf}` }));
  return <section className="panel followups-panel" aria-label="库存持续跟进">
    <div className="section-title-row"><div><span className="eyebrow">变化来了，继续把事情办好</span><h2>库存持续跟进</h2></div>
      <button className="secondary small" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起表单' : '建立跟进'}</button></div>
    <p className="helper-text">明确对象和结束时间后，助手会跟进相关数据变化；有可用结果、需要判断或遇到阻塞时再告诉你。</p>
    {!followups && <p role="status">正在读取跟进状态，暂不能提交设置。</p>}
    {expanded && <form className="watch-form" onSubmit={event => void create(event)}>
      <label>跟进哪份库存方案<select aria-label="跟进的库存方案" value={drafts.watch.inventoryId} onChange={event => setDrafts(current => ({ ...current, watch: { ...current.watch, inventoryId: event.target.value } }))}>
        <option value="">请选择一份库存方案</option>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {choices.length === 0 && <p className="helper-text">还没有库存方案。请先到“库存补货”建立方案，再回来授权跟进。</p>}
      <label>跟进到什么时候<input aria-label="跟进结束时间" type="datetime-local" required value={drafts.watch.expiresLocal} onChange={event => setDrafts(current => ({ ...current, watch: { ...current.watch, expiresLocal: event.target.value } }))} /></label>
      <p className="helper-text">按本设备时区填写，提交时转为明确时间；到期自动停止，不会无限期跟进。</p>
      <label>工作名称（可选）<input maxLength={160} value={drafts.watch.title} onChange={event => setDrafts(current => ({ ...current, watch: { ...current.watch, title: event.target.value } }))} /></label>
      <div className="authorization-note">此次仅授权读取相关库存变化、提供内部建议和待确认草稿，不执行平台建单、改价或广告操作。</div>
      <button className="primary small" disabled={busy || !followups || !canChat(status) || !drafts.watch.inventoryId || !drafts.watch.expiresLocal}>授权并开始跟进</button>
      {!canChat(status) && <p className="helper-text">助手暂未开放，现有记录仍保留；已建立的跟进仍可停止。</p>}
    </form>}
    <div className="watch-list">{followups?.watches.map(watch => <article className="watch-item" key={watch.id}>
      <div className="work-ticket-heading"><strong>{watch.title}</strong><span className={`badge ${watch.status === 'active' ? 'green' : ''}`}>{watchLabels[watch.status]}</span></div>
      <p>{watch.store} · {watch.site} · {watch.listing}</p><p className="helper-text">跟进至 {new Date(watch.expiresAt).toLocaleString('zh-CN')} · 仅内部建议与草稿</p>
      {watch.status === 'active' && <button className="text-button quiet-danger" disabled={busy} onClick={() => void submit('followups/stop', { id: watch.id, revision: watch.revision }, `watch-stop:${watch.id}`)}>停止跟进</button>}
    </article>)}</div>
    {followups?.watches.length === 0 && <p className="helper-text">还没有持续跟进。普通一次性请求仍在上方对话中处理。</p>}
    <details className="rule-settings"><summary>缺货复核规则 · {ruleLabels[followups?.rule?.mode ?? 'observe']}</summary>
      <p>只检查你明确选中的库存方案。观察模式会记录“是否应接单”，不启动执行助手、不创建业务草稿；评估可能使用模型。</p>
      <label>工作方式<select aria-label="缺货复核工作方式" value={rule.mode} onChange={event => setDrafts(current => ({ ...current, rule: { ...rule, mode: event.target.value as typeof rule.mode } }))}>
        <option value="off">关闭规则</option><option value="observe">观察模式：先看判断依据</option><option value="auto" disabled={!followups?.autoAvailable}>自动复核：只生成内部草稿</option>
      </select></label>
      {!followups?.autoAvailable && <p className="helper-text">{followups?.autoBlockedReason ?? '自动复核尚未通过启用检查，目前可以先观察。'}</p>}
      <fieldset><legend>明确选择检查对象</legend>{choices.length === 0 && <p className="helper-text">暂无可选择的库存方案。</p>}
        {choices.map(item => <label className="rule-choice" key={item.id}><input type="checkbox" checked={rule.inventoryIds.includes(item.id)} onChange={event => setDrafts(current => ({ ...current, rule: { ...rule,
          inventoryIds: event.target.checked ? [...rule.inventoryIds, item.id] : rule.inventoryIds.filter(id => id !== item.id) } }))} />{item.label}</label>)}
      </fieldset>
      <p className="helper-text">未选择对象就不检查任何方案。已有持续跟进的同一对象会优先交给原工单，避免重复接单。</p>
      <button className="secondary small" disabled={busy || !followups || (rule.mode === 'auto' && !followups.autoAvailable)} onClick={() => void submit('followups/rule', rule, 'rule-save').then(saved => {
        if (saved) setDrafts(current => ({ ...current, rule: JSON.stringify(current.rule ?? rule) === JSON.stringify(rule) ? undefined : current.rule }));
      })}>保存规则设置</button>
    </details>
    {(followups?.assessments?.length ?? 0) > 0 && <div className="rule-assessments"><h3>最近的规则判断</h3>{followups!.assessments!.slice(0, 5).map(item => <article key={item.eventId}>
      <span className="badge">{({ would_accept: '观察：符合接单条件', accepted: '已接单', ignored: '无需接单', unavailable: '评估未完成', pending: '等待评估' })[item.decision]}</span><p>{item.reason}</p>
    </article>)}</div>}
    {(followups?.events.length ?? 0) > 0 && <details className="ticket-details"><summary>查看最近的数据变化</summary>{followups!.events.slice(0, 5).map(item => <article className="watch-event" key={item.eventId}>
      <strong>{item.risk.store} · {item.risk.listing}</strong><p>{item.risk.summary}</p><small>{item.status === 'delivered' ? '已投递至编排流程，结果以工单和规则判断为准' : '等待处理'} · {item.eventClass === 'watch_update' ? '持续跟进变化' : '风险候选'}</small>
    </article>)}</details>}
  </section>;
}
