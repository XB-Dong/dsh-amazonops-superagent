import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorkSnapshot } from '../contracts/model.ts';
import { api, canChat, modelLabel, requestId, type Snapshot, type Status } from './api.ts';
import { messageIntent, workMessages } from './work.ts';

const labels: Record<string, string> = {
  working: '处理中', running: '处理中', queued: '排队中', pending: '排队中', waiting: '等待补充',
  ready: '结果已准备', completed: '已交付', ended: '已结束', cancelled: '已取消', blocked: '需要补充', failed: '未完成',
};
export function Assistant({ status, initialPrompt, refresh, reportError, openSession }: {
  data: Snapshot; status?: Status; initialPrompt: string; refresh: () => Promise<void>;
  reportError: (message: string) => void; openSession?: (id: string) => void;
}) {
  const [text, setText] = useState(initialPrompt);
  const [threadId, setThreadId] = useState<string>();
  const [work, setWork] = useState<WorkSnapshot>({ tickets: [], messages: [] });
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const intent = useRef<ReturnType<typeof messageIntent> | undefined>(undefined);
  useEffect(() => setText(initialPrompt), [initialPrompt]);
  async function readWork() {
    const next = await api<WorkSnapshot>('work');
    setWork(next);
    setConnection('');
  }
  useEffect(() => {
    let active = true;
    async function poll() {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await api<WorkSnapshot>('work');
        if (active) { setWork(next); setConnection(''); }
      } catch { if (active) setConnection('暂时无法刷新进度，已提交的工作会继续保留。'); }
    }
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || !canChat(status)) return;
    intent.current = messageIntent(intent.current, text.trim(), threadId, requestId);
    setBusy(true);
    try {
      const result = await api<{ threadId: string }>('messages', intent.current);
      setThreadId(result.threadId);
      intent.current = undefined;
      setText('');
      await readWork();
      await refresh();
    } catch (error) { reportError(error instanceof Error ? error.message : '消息未能提交，请稍后重试。'); }
    finally { setBusy(false); }
  }
  async function cancel(ticketId: string) {
    setBusy(true);
    try { await api('cancel', { ticketId }); await readWork(); await refresh(); }
    catch (error) { reportError(error instanceof Error ? error.message : '取消未完成，请稍后查看进度。'); }
    finally { setBusy(false); }
  }
  const threads = [...new Set(work.messages.map((message) => message.threadId))];
  return <div className="assistant-layout">
    <section className="chat-panel panel">
      <div className="chat-heading"><div><h2>cc，你好！</h2><p>{modelLabel(status)}。你可以创建任务草稿、复制清单，或记录改进建议。</p></div>
        <button className="secondary small" onClick={() => { setThreadId(undefined); intent.current = undefined; setText(''); }}>新对话</button></div>
      <p className="helper-text">关闭页面后工作仍会继续；需要停止时，点击工单上的“取消”。草稿需在任务清单中确认。</p>
      {threads.length > 0 && <label>最近对话<select value={threadId ?? ''} onChange={(event) => { setThreadId(event.target.value || undefined); intent.current = undefined; }}>
        <option value="">选择对话或开始新对话</option>{threads.map((id) => <option key={id} value={id}>{work.messages.find((message) => message.threadId === id && message.role === 'user')?.text.slice(0, 36) ?? '已保存的对话'}</option>)}</select></label>}
      <div className="chat-messages" aria-live="polite">
        {workMessages(work, threadId).map((message) => <article key={message.id} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? '你' : '运营助手'}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{message.text}</p></article>)}
      </div>
      {connection && <p role="status">{connection}</p>}
      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <textarea aria-label="对助手说" value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="例如：复制已有清单，换成新的链接标识" />
        <button className="primary" disabled={busy || !canChat(status) || !text.trim()}>{busy ? '正在提交…' : '发送'}</button>
      </form>
    </section>
    <aside className="panel assistant-side"><h2>助手工作进度</h2><p>这里表示助手交付进度，业务任务是否完成仍以任务清单为准。</p>
      {work.tickets.length === 0 && <p>还没有助手工单。</p>}
      {work.tickets.map((ticket) => <article className="work-ticket" key={ticket.id}><h3>{ticket.title}</h3><p>{labels[ticket.status] ?? '状态待确认'}</p>
        {ticket.latestReport?.text && <p>{ticket.latestReport.text}</p>}
        {ticket.sessionId && openSession && <button className="text-button" onClick={() => openSession(ticket.sessionId!)}>打开原生会话</button>}
        {['working', 'running', 'queued', 'pending', 'waiting', 'blocked'].includes(ticket.status) && <button disabled={busy} className="secondary small" onClick={() => void cancel(ticket.id)}>取消</button>}
      </article>)}
    </aside>
  </div>;
}
