import type { WorkSnapshot } from '../contracts/model.ts';
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
