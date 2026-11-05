import { useEffect, useState, type FormEvent } from 'react';
import type { WorkAction, WorkSnapshot } from '../contracts/model.ts';
import { api, canChat, modelLabel, requestId, type Snapshot, type Status } from './api.ts';
import { workMessages } from './work.ts';
import { stableFormIntent, type AssistantDraftState, type SetAssistantDrafts } from './assistant-state.ts';
import { WorkTickets } from './WorkTickets.tsx';
import { FollowupsPanel, type FollowupView } from './FollowupsPanel.tsx';

export function Assistant({ data, status, initialPrompt, refresh, reportError, openSession, drafts, setDrafts }: {
  data: Snapshot; status?: Status; initialPrompt: string; refresh: () => Promise<void>;
  reportError: (message: string) => void; openSession?: (id: string) => void;
  drafts: AssistantDraftState; setDrafts: SetAssistantDrafts;
}) {
  const [work, setWork] = useState<WorkSnapshot>({ tickets: [], messages: [] });
  const [followups, setFollowups] = useState<FollowupView>();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (initialPrompt && initialPrompt !== drafts.lastPrompt)
      setDrafts(current => ({ ...current, text: initialPrompt, lastPrompt: initialPrompt }));
  }, [initialPrompt, drafts.lastPrompt, setDrafts]);
  async function readWork() {
    const results = await Promise.allSettled([api<WorkSnapshot>(`work?offset=${page}&limit=20`), api<FollowupView>('followups')]);
    if (results[0].status === 'fulfilled') setWork(results[0].value);
    if (results[1].status === 'fulfilled') setFollowups(results[1].value);
    setConnection(results.some(item => item.status === 'rejected') ? '暂时无法刷新全部进度。已提交的工作和未提交的草稿仍保留。' : '');
  }
  useEffect(() => {
    let active = true;
    async function poll() {
      if (document.visibilityState !== 'visible') return;
      const results = await Promise.allSettled([api<WorkSnapshot>(`work?offset=${page}&limit=20`), api<FollowupView>('followups')]);
      if (!active) return;
      if (results[0].status === 'fulfilled') setWork(results[0].value);
      if (results[1].status === 'fulfilled') setFollowups(results[1].value);
      setConnection(results.some(item => item.status === 'rejected') ? '暂时无法刷新全部进度。已提交的工作和未提交的草稿仍保留。' : '');
    }
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => { active = false; clearInterval(timer); };
  }, [page]);
  async function perform(path: string, body: object): Promise<boolean> {
    setBusy(true); reportError(''); setNotice('');
    try {
      await api(path, body);
      await readWork(); await refresh();
      setNotice('已提交，请查看最新进度。业务草稿仍需你确认。');
      return true;
    } catch (error) {
      reportError(error instanceof Error ? error.message : '操作尚未完成，已保留填写内容，请稍后重试。');
      return false;
    } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = drafts.text.trim();
    if (!text || busy || !canChat(status)) return;
    const key = `chat:${drafts.threadId ?? 'new'}`;
    const body = { text, ...(drafts.threadId ? { threadId: drafts.threadId } : {}) };
    const intent = stableFormIntent(drafts.intents[key], body, requestId);
    setDrafts(current => ({ ...current, intents: { ...current.intents, [key]: intent } }));
    setBusy(true); reportError(''); setNotice('');
    try {
      const result = await api<{ threadId: string }>('messages', { ...body, requestId: intent.requestId });
      setDrafts(current => ({ ...current, threadId: result.threadId,
        text: current.text.trim() === text ? '' : current.text,
        intents: Object.fromEntries(Object.entries(current.intents).filter(([name]) => name !== key)) }));
      await readWork(); await refresh();
    } catch (error) { reportError(error instanceof Error ? error.message : '消息未能提交，填写内容已保留。'); }
    finally { setBusy(false); }
  }
  const threads = [...new Set(work.messages.map(message => message.threadId))];
  return <div className="assistant-layout p1-assistant">
    <section className="chat-panel panel">
      <div className="chat-heading"><div><span className="eyebrow">你的运营搭档</span><h2>cc，你好！</h2><p>{modelLabel(status)}。一起把事情往前推进。</p></div>
        <button className="secondary small" disabled={busy} onClick={() => setDrafts(current => ({ ...current, threadId: undefined, text: '' }))}>新对话</button></div>
      <p className="helper-text chat-hint">可以创建任务草稿、复制清单或记录建议。关闭页面不会取消工作；需要停止时，在对应工单中操作。</p>
      {threads.length > 0 && <label className="thread-picker">最近对话<select value={drafts.threadId ?? ''} onChange={event => setDrafts(current => ({ ...current, threadId: event.target.value || undefined }))}>
        <option value="">选择对话或开始新对话</option>{threads.map(id => <option key={id} value={id}>{work.messages.find(message => message.threadId === id && message.role === 'user')?.text.slice(0, 36) ?? '已保存的对话'}</option>)}</select></label>}
      <div className="chat-messages" aria-live="polite">
        {workMessages(work, drafts.threadId).map(message => <article key={message.id} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? '你' : '运营助手'}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{message.text}</p></article>)}
        {!drafts.threadId && <div className="assistant-empty"><strong>先说说你想完成什么</strong><p>例如：读取已有库存检查清单，复制成新的待确认草稿。</p><p>需要持续关注数据变化时，可在下方建立有结束时间的库存跟进。</p></div>}
      </div>
      <form className="chat-composer" onSubmit={event => void submit(event)}>
        <textarea aria-label="对助手说" value={drafts.text} maxLength={2000} onChange={event => setDrafts(current => ({ ...current, text: event.target.value }))} placeholder="例如：复制已有清单，换成新的链接标识" />
        <button className="primary" disabled={busy || !canChat(status) || !drafts.text.trim()}>{busy ? '正在提交…' : '发送'}</button>
      </form>
    </section>
    <WorkTickets work={work} drafts={drafts} setDrafts={setDrafts} busy={busy}
      perform={(body: WorkAction) => perform('work-actions', body)} openSession={openSession} page={page} changePage={setPage} />
    {(connection || notice) && <p className={`assistant-banner ${connection ? 'warning' : ''}`} role="status">{connection || notice}</p>}
    <FollowupsPanel data={data} status={status} followups={followups} drafts={drafts} setDrafts={setDrafts} busy={busy} perform={perform} reportError={reportError} />
  </div>;
}
