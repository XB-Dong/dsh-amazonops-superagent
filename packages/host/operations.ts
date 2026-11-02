import { createHash, randomUUID } from 'node:crypto';
export type SourceEvent = { eventClass: string; actorKind: string; authenticated: boolean; scope?: string };
export const admitEvent = (event: SourceEvent): boolean =>
  event.eventClass === 'human_request' && event.actorKind === 'human' &&
  event.authenticated === true && /^[a-z0-9][a-z0-9-]{0,39}$/.test(event.scope ?? '');
export interface IntentStore {
  once<T>(scope: string, key: string, create: () => T): T;
}
export class StableOperations {
  store: IntentStore;
  constructor(store: IntentStore) { this.store = store; }
  resolve(scope: string, event: string, kind: string, payload: unknown, slot = '0'): string {
    if (!event || !kind || !slot) throw new Error('OPERATION_CONTEXT_REQUIRED');
    const hash = createHash('sha256').update(canonical(payload)).digest('hex');
    const key = `logical-operation:${JSON.stringify([event,kind,slot])}`;
    const intent = this.store.once(scope,key,()=>({operationId:randomUUID(),payloadHash:hash,sourceId:event}));
    if (intent.payloadHash !== hash) throw new Error('OPERATION_CONFLICT');
    return intent.operationId;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
