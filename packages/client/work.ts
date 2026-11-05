import type { WorkSnapshot, WorkTicket, WorkAction } from '../contracts/model.ts';
export function workMessages(work: WorkSnapshot, threadId?: string) {
  const seen = new Set<string>();
  return work.messages.filter((message) => {
    if (!threadId || message.threadId !== threadId || seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}
export function messageIntent(previous: { text: string; threadId?: string; requestId: string } | undefined, text: string, threadId: string | undefined, createId: () => string) {
  return previous?.text === text && previous.threadId === threadId
    ? previous : { text, threadId, requestId: createId() };
}

export type WorkDraft = WorkAction & { text: string };
export type WorkDrafts = Readonly<Record<string, WorkDraft>>;
export const workDraftKey = (ticket: WorkTicket, action: WorkAction['action']) =>
  JSON.stringify([ticket.id, action, action === 'answer' ? ticket.attention?.id : '']);
export function openWorkDraft(drafts: WorkDrafts, ticket: WorkTicket, action: WorkAction['action'], createId: () => string): WorkDrafts {
  const key = workDraftKey(ticket, action);
  if (drafts[key]) return drafts;
  if (!ticket.updatedAt || !availableWorkActions(ticket).includes(action)) throw new Error('工单状态已变化，请刷新后重新选择操作。');
  return { ...drafts, [key]: { ticketId: ticket.id, requestId: createId(), expectedUpdatedAt: ticket.updatedAt,
    action, text: '', ...(action === 'answer' ? { attentionId: ticket.attention!.id } : {}) } };
}
export function changeWorkDraft(drafts: WorkDrafts, key: string, text: string, createId: () => string): WorkDrafts {
  const current = drafts[key];
  return !current || current.text === text ? drafts : { ...drafts, [key]: { ...current, text, requestId: createId() } };
}
export function closeWorkDraft(drafts: WorkDrafts, key: string): WorkDrafts {
  const next = { ...drafts }; delete next[key]; return next;
}
export function acknowledgeWorkDraft(drafts: WorkDrafts, key: string, requestId: string): WorkDrafts {
  return drafts[key]?.requestId === requestId ? closeWorkDraft(drafts, key) : drafts;
}
export function workActionPayload(draft: WorkDraft): WorkAction {
  const { text, ...rest } = draft;
  if (draft.action === 'answer' || draft.action === 'supplement') {
    if (!text.trim()) throw new Error('请先填写要提交的内容。');
    return { ...rest, text: text.trim() };
  }
  return rest;
}
export function availableWorkActions(ticket: WorkTicket): NonNullable<WorkTicket['actions']> {
  if (!ticket.updatedAt) return [];
  return (ticket.actions ?? []).filter(action => action !== 'answer' || !!ticket.attention);
}
const legacyLabels: Record<string, string> = { working: '处理中', running: '处理中', queued: '排队中', pending: '排队中',
  waiting: '等待后续变化', ready: '结果已准备', completed: '已交付', ended: '已结束', stopped: '已停止', cancelled: '已取消',
  blocked: '需要补充', failed: '未完成', dropped: '无需继续' };
export function workStageLabel(ticket: WorkTicket): string {
  const stage = ticket.stage;
  if (stage?.stage === 'person') return ({ answer: '等待你作决定', review: '等待你审核', delivery: '消息待重新投递',
    blocked: '需要你补充信息', failed: '需要你处理失败' } as Record<string, string>)[stage.action ?? ''] ?? '等待你处理';
  if (stage?.stage === 'idle') return '等待后续变化';
  if (stage?.stage === 'working') return stage.action === 'queued' ? '排队中' : '助手正在处理';
  return legacyLabels[ticket.status] ?? '状态待确认';
}
export function watchExpiry(value: string, currentTime = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('请填写明确的跟进结束时间。');
  const parsed = new Date(value);
  const local = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  if (local !== value) throw new Error('跟进结束时间不存在，请重新选择。');
  if (parsed.getTime() <= currentTime) throw new Error('跟进结束时间必须晚于现在。');
  return parsed.toISOString();
}
