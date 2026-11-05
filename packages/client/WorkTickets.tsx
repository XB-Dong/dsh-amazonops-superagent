import type { WorkAction, WorkSnapshot, WorkTicket } from '../contracts/model.ts';
import { requestId } from './api.ts';
import type { AssistantDraftState, SetAssistantDrafts } from './assistant-state.ts';
import { acknowledgeWorkDraft, availableWorkActions, changeWorkDraft, closeWorkDraft, openWorkDraft, workActionPayload, workDraftKey, workStageLabel } from './work.ts';

const actionLabels = { supplement: '补充信息', answer: '回答这个问题', retry: '重新尝试', stop: '停止工单' };
export function WorkTickets({ work, busy, drafts, setDrafts, perform, openSession, page, changePage }: {
  work: WorkSnapshot; busy: boolean; drafts: AssistantDraftState; setDrafts: SetAssistantDrafts;
  perform: (body: WorkAction) => Promise<boolean>; openSession?: (id: string) => void;
  page: number; changePage: (offset: number) => void;
}) {
  async function start(ticket: WorkTicket, action: WorkAction['action']) {
    const actions = openWorkDraft(drafts.actions, ticket, action, requestId);
    const key = workDraftKey(ticket, action);
    setDrafts(current => ({ ...current, actions, activeActionKey: key }));
    if (action === 'retry' || action === 'stop') await send(key, actions);
  }
  async function send(key: string, actions = drafts.actions) {
    const draft = actions[key];
    if (!draft) return;
    if (await perform(workActionPayload(draft))) setDrafts(current => current.actions[key]?.requestId !== draft.requestId ? current : ({ ...current,
      actions: acknowledgeWorkDraft(current.actions, key, draft.requestId), activeActionKey: current.activeActionKey === key ? undefined : current.activeActionKey }));
  }
  function cancel(key: string) {
    setDrafts(current => ({ ...current, actions: closeWorkDraft(current.actions, key), activeActionKey: undefined }));
  }
  const pagination = work.pagination;
  return <section className="panel assistant-work" aria-label="助手工作进度">
    <div className="section-title-row"><div><span className="eyebrow">每件事，都有着落</span><h2>助手工作进度</h2></div>
      <span className="count-label">{pagination?.total ?? work.tickets.length} 件工作</span></div>
    <p className="helper-text">这里记录助手承接的工作。草稿交付后，仍需到任务清单确认与执行。</p>
    {work.tickets.length === 0 && <div className="assistant-empty"><strong>还没有助手工单</strong><p>发送一条请求，或授权一项有结束时间的库存跟进，进度会显示在这里。</p></div>}
    <div className="work-ticket-list">{work.tickets.map(ticket => {
      const key = drafts.activeActionKey;
      const draft = key && drafts.actions[key]?.ticketId === ticket.id ? drafts.actions[key] : undefined;
      const human = ticket.stage?.stage === 'person';
      return <article className={`work-ticket ${human ? 'needs-person' : ''}`} key={ticket.id}>
        <div className="work-ticket-heading"><h3>{ticket.title}</h3><span className={`badge ${human ? 'amber' : ticket.stage?.stage === 'ended' ? '' : 'green'}`}>{workStageLabel(ticket)}</span></div>
        {ticket.attention && <div className="attention-question"><strong>需要你作决定</strong><p>{ticket.attention.question}</p></div>}
        {ticket.latestReport?.text && <p className="ticket-report">{ticket.latestReport.text}</p>}
        <details className="ticket-details"><summary>查看责任与执行记录</summary>
          <dl><div><dt>工作范围</dt><dd>{ticket.mandate?.scope ?? '等待助手确认范围'}</dd></div>
            <div><dt>开始依据</dt><dd>{ticket.mandate?.strength === 'inferred' ? '已启用的主动规则' : '用户明确请求'}</dd></div>
            <div><dt>执行状态</dt><dd>{ticket.assignment ? ({ pending: '等待分配', running: '已分配执行助手', ended: '本次执行已结束' } as Record<string,string>)[ticket.assignment.state] ?? '等待状态更新' : '尚未分配'}</dd></div>
            {ticket.updatedAt && <div><dt>最近更新</dt><dd>{new Date(ticket.updatedAt).toLocaleString('zh-CN')}</dd></div>}
          </dl>
          {ticket.sessionId && openSession && <button className="text-button" onClick={() => openSession(ticket.sessionId!)}>打开原生会话</button>}
        </details>
        <div className="ticket-actions">{availableWorkActions(ticket).map(action => <button key={action} disabled={busy}
          className={`${action === 'answer' ? 'primary' : 'secondary'} small ${action === 'stop' ? 'quiet-danger' : ''}`}
          onClick={() => void start(ticket, action)}>{actionLabels[action]}</button>)}</div>
        {draft && key && <form className="ticket-answer" onSubmit={event => { event.preventDefault(); void send(key); }}>
          {['answer', 'supplement'].includes(draft.action) ? <label>{draft.action === 'answer' ? '你的答复' : '补充给这件工作的内容'}
            <textarea aria-label={`${ticket.title}的${draft.action === 'answer' ? '答复' : '补充信息'}`} maxLength={2000} value={draft.text}
              onChange={event => setDrafts(current => ({ ...current, actions: changeWorkDraft(current.actions, key, event.target.value, requestId) }))} /></label>
            : <p>上次提交未能确认结果，你可以重试原请求，或取消后重新读取状态。</p>}
          {(draft.expectedUpdatedAt !== ticket.updatedAt || (draft.action === 'answer' && draft.attentionId !== ticket.attention?.id)) && <p className="helper-text">工单或问题已更新，草稿仍保留。提交时会核对原版本，过期答复不会发给新问题。</p>}
          <div className="ticket-actions"><button className="primary small" disabled={busy || (['answer','supplement'].includes(draft.action) && !draft.text.trim())}>提交{draft.action === 'answer' ? '答复' : draft.action === 'supplement' ? '补充' : '原请求'}</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => cancel(key)}>取消编辑</button></div>
        </form>}
      </article>;
    })}</div>
    {pagination && (pagination.total > 20 || page > 0) && <nav className="work-pagination" aria-label="助手工单分页">
      <button className="secondary small" disabled={busy || page === 0} onClick={() => changePage(Math.max(0, page - 20))}>上一页</button>
      <span>第 {Math.floor(page / 20) + 1} 页 · 共 {pagination.total} 件</span>
      <button className="secondary small" disabled={busy || pagination.nextOffset === null} onClick={() => changePage(pagination.nextOffset!)}>下一页</button>
    </nav>}
  </section>;
}
