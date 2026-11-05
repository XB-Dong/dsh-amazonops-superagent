import type { Dispatch, SetStateAction } from 'react';
import type { WorkDrafts } from './work.ts';

export type AssistantDraftState = {
  text: string; threadId?: string; lastPrompt: string;
  actions: WorkDrafts; activeActionKey?: string;
  watch: { inventoryId: string; expiresLocal: string; title: string };
  rule?: { mode: 'off' | 'observe' | 'auto'; inventoryIds: string[] };
  intents: Record<string, { fingerprint: string; requestId: string }>;
};
export type SetAssistantDrafts = Dispatch<SetStateAction<AssistantDraftState>>;
export const emptyAssistantDrafts = (): AssistantDraftState => ({ text: '', lastPrompt: '', actions: {},
  watch: { inventoryId: '', expiresLocal: '', title: '' }, intents: {} });
export function stableFormIntent(previous: AssistantDraftState['intents'][string] | undefined, body: object, createId: () => string) {
  const fingerprint = JSON.stringify(body);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: createId() };
}
