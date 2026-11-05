import { digest, type Base, type BusinessEvent } from '../core/store.ts';
import type { FollowupEvent, InventoryRule, RiskSnapshot } from '../../contracts/followups.ts';
import { liveEntity, sameInventory } from './risk.ts';
import type { Followups, WatchRecord } from './index.ts';
import { acceptedWindow } from './decisions.ts';

type Cursor = Base & { sequence: number; ruleRevision: number };
const relevantKinds = new Set(['business:inventory', 'business:forecast', 'business:report-import']);
function unavailable(error: unknown): boolean {
  return error instanceof Error && /^(?:NOT_FOUND|SOURCE_DELETED|DERIVATION_REVOKED|INVALID_REFERENCE|INVALID_FORECAST|INVALID_INVENTORY|INVALID_NUMBER|INVALID_QUANTITY|INVALID_LEAD_TIME|PAST_INBOUND|INVALID_DEMAND_FACTOR|WATCH_INACTIVE|WATCH_EXPIRED|HUMAN_SOURCE_REQUIRED)$/.test(error.message);
}
function relevant(service: Followups, scope: string, event: BusinessEvent, risk: RiskSnapshot): boolean {
  if (!relevantKinds.has(event.kind) || !event.entityId) return false;
  try {
    const entity = liveEntity<Base & { store?: string; site?: string; listing?: string; physicalSku?: string }>(service.store, scope, event.entityId);
    if (event.entityRevision !== undefined && event.entityRevision !== entity.revision) return false;
    if (event.kind === 'business:inventory' && entity.kind === 'inventory') return sameInventory(entity as unknown as RiskSnapshot, risk);
    if (event.kind === 'business:forecast' && entity.kind === 'forecast') return entity.store === risk.store && entity.site === risk.site && entity.listing === risk.listing;
    return event.kind === 'business:report-import' && entity.kind === 'report' && entity.store === risk.store && entity.site === risk.site;
  } catch (error) { if (!unavailable(error)) throw error; return false; }
}
function enqueue(service: Followups, scope: string, risk: RiskSnapshot, sequence: number, watch?: WatchRecord, rule?: InventoryRule): void {
  if (rule?.mode === 'auto' && acceptedWindow(service.store, scope, rule.id, risk.digest)) return;
  const owner = watch ? `watch:${watch.id}` : `rule:${rule!.id}:${rule!.revision}:${rule!.mode}`;
  const eventId = `followup-${digest([scope, owner, risk.digest, ...(watch ? [sequence] : [])])}`;
  if (service.store.isDeleted(scope, eventId) || service.store.list<FollowupEvent>(scope, 'followup-event').some(row => row.eventId === eventId)) return;
  service.store.create(scope, 'followup-event', {
    eventClass: watch ? 'watch_update' as const : 'risk_candidate' as const, eventId, sequence, inventoryId: risk.inventoryId,
    ...(watch ? { watchId: watch.id } : { ruleRevision: rule!.revision, ruleMode: rule!.mode as 'observe' | 'auto' }),
    risk, status: 'pending' as const,
    sources: [...new Set([...(watch ? [watch.id, watch.sourceId] : [rule!.id, rule!.sourceId]), ...risk.sourceIds])],
  }, eventId);
}
export function scanEvents(service: Followups, scope: string): void {
  service.store.transaction(() => {
    service.expire(scope);
    const cursor = service.store.list<Cursor>(scope, 'followup-cursor')[0];
    const events: BusinessEvent[] = [];
    let sequence = cursor?.sequence ?? 0;
    for (;;) {
      const batch = service.store.events(scope, sequence, 100);
      if (!batch.length) break;
      events.push(...batch); sequence = batch.at(-1)!.sequence;
      if (batch.length < 100) break;
    }
    const watches = service.store.list<WatchRecord>(scope, 'inventory-watch').flatMap(row => {
      try { const watch = service.record(scope, row.id); service.requireActive(watch); return [watch]; }
      catch (error) { if (!unavailable(error)) throw error; return []; }
    });
    for (const watch of watches) {
      try {
        const risk = service.risk(scope, watch.inventoryId);
        const previous = service.store.list<FollowupEvent>(scope, 'followup-event').filter(row => row.watchId === watch.id)
          .sort((a, b) => b.sequence - a.sequence)[0];
        if (risk.digest === (previous?.risk.digest ?? watch.initialDigest)) continue;
        const changes = events.filter(event => event.sequence > watch.startSequence && relevant(service, scope, event, risk));
        if (changes.length) enqueue(service, scope, risk, changes.at(-1)!.sequence, watch);
      } catch (error) { if (!unavailable(error)) throw error; }
    }
    let rule: InventoryRule | null = null;
    try { rule = service.rule(scope); } catch (error) { if (!unavailable(error)) throw error; }
    if (rule && rule.mode !== 'off') for (const inventoryId of rule.inventoryIds) {
      try {
        const risk = service.risk(scope, inventoryId);
        if (!risk.stockoutDate || watches.some(watch => sameInventory(watch, risk))) continue;
        const changes = events.filter(event => relevant(service, scope, event, risk));
        if (cursor?.ruleRevision !== rule.revision || changes.length) enqueue(service, scope, risk, changes.at(-1)?.sequence ?? sequence, undefined, rule);
      } catch (error) { if (!unavailable(error)) throw error; }
    }
    const next = { sequence, ruleRevision: rule?.revision ?? 0 };
    if (!cursor) service.store.create(scope, 'followup-cursor', next);
    else if (cursor.sequence !== next.sequence || cursor.ruleRevision !== next.ruleRevision) service.store.update(cursor, next);
  });
}
export function pendingEvents(service: Followups, scope: string): FollowupEvent[] {
  const events = service.store.list<FollowupEvent>(scope, 'followup-event');
  const latest = new Map<string, FollowupEvent>();
  for (const event of events) if (event.watchId && (!latest.has(event.watchId)
    || event.sequence > latest.get(event.watchId)!.sequence)) latest.set(event.watchId, event);
  return events.filter(event => {
    if (event.status !== 'pending') return false;
    if (event.watchId && latest.get(event.watchId)?.id !== event.id) return false;
    try {
      liveEntity(service.store, scope, event.id, 'followup-event');
      const risk = service.risk(scope, event.inventoryId);
      if (risk.digest !== event.risk.digest) return false;
      if (event.watchId) {
        const watch = service.record(scope, event.watchId); service.requireActive(watch); return sameInventory(watch, risk);
      }
      const rule = service.rule(scope);
      if (!rule || rule.mode === 'off' || rule.mode !== event.ruleMode || rule.revision !== event.ruleRevision || !risk.stockoutDate) return false;
      if (rule.mode === 'auto' && acceptedWindow(service.store, scope, rule.id, risk.digest)) return false;
      if (!rule.inventoryIds.some(id => sameInventory(service.risk(scope, id), risk))) return false;
      return !service.list(scope).some(watch => watch.status === 'active' && Date.parse(watch.expiresAt) > service.clock().getTime() && sameInventory(watch, risk));
    } catch (error) { if (!unavailable(error)) throw error; return false; }
  }).sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt));
}
