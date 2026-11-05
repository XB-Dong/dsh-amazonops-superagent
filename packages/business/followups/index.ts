import { Store } from '../core/store.ts';
import { safeText } from '../core/validation.ts';
import type { Inventory } from '../operations/inventory.ts';
import type { WatchCreate, InventoryWatch, InventoryRule, RiskSnapshot, FollowupEvent, FollowupSnapshot } from '../../contracts/followups.ts';
import { humanSource, inventoryRisk, liveEntity } from './risk.ts';
import { scanEvents, pendingEvents } from './scan.ts';

export type WatchRecord = InventoryWatch & { startSequence: number; initialDigest: string };
export type RuleInput = { requestId: string; mode: 'off' | 'observe' | 'auto'; inventoryIds: string[] };
export const watchView = ({ startSequence: _sequence, initialDigest: _digest, ...watch }: WatchRecord): InventoryWatch => watch;

export class Followups {
  constructor(readonly store: Store, readonly clock: () => Date = () => new Date()) {}
  create(scope: string, input: WatchCreate, sourceId: string): InventoryWatch {
    const requestId = safeText(input.requestId, 100), inventoryId = safeText(input.inventoryId, 100);
    humanSource(this.store, scope, sourceId);
    const inventory = liveEntity<Inventory>(this.store, scope, inventoryId, 'inventory');
    if (typeof input.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(input.expiresAt)
      || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= this.clock().getTime()
      || new Date(`${input.expiresAt.slice(0, 10)}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.expiresAt.slice(0, 10))
      throw new Error('INVALID_WATCH_EXPIRY');
    const expiresAt = new Date(input.expiresAt).toISOString();
    const title = input.title === undefined ? `库存持续跟进：${inventory.listing}` : safeText(input.title, 120);
    const receipt = this.store.command(scope, `watch-create:${requestId}`, { inventoryId, expiresAt, title, sourceId }, () => {
      const risk = this.risk(scope, inventoryId);
      const startSequence = Number(this.store.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM business_events WHERE scope=?').get(scope)?.n);
      return this.store.create(scope, 'inventory-watch', { inventoryId, store: inventory.store, site: inventory.site,
        listing: inventory.listing, physicalSku: inventory.physicalSku, title, expiresAt, status: 'active' as const,
        sourceId, sources: [...new Set([sourceId, inventoryId, ...risk.sourceIds])], startSequence, initialDigest: risk.digest });
    });
    return this.get(scope, receipt.id);
  }
  get(scope: string, id: string): InventoryWatch { return watchView(this.record(scope, id)); }
  record(scope: string, id: string): WatchRecord {
    const watch = liveEntity<WatchRecord>(this.store, scope, id, 'inventory-watch');
    humanSource(this.store, scope, watch.sourceId); return watch;
  }
  list(scope: string): InventoryWatch[] {
    return this.store.list<WatchRecord>(scope, 'inventory-watch').flatMap(row => {
      try { return [this.get(scope, row.id)]; } catch { return []; }
    });
  }
  bindTicket(scope: string, id: string, ticketId: string): InventoryWatch {
    ticketId = safeText(ticketId, 100);
    return this.store.transaction(() => {
      const watch = this.record(scope, id); this.requireActive(watch);
      if (watch.ticketId && watch.ticketId !== ticketId) throw new Error('WATCH_TICKET_CONFLICT');
      return watchView(watch.ticketId ? watch : this.store.update(watch, { ticketId }));
    });
  }
  stop(scope: string, id: string, revision: number): InventoryWatch {
    return this.store.transaction(() => {
      const watch = this.record(scope, id);
      if (watch.revision !== revision) throw new Error('REVISION_CONFLICT');
      return watchView(watch.status !== 'active' ? watch : this.store.update(watch, { status: 'stopped' }, revision));
    });
  }
  expire(scope: string): void {
    this.store.transaction(() => {
      for (const watch of this.store.list<WatchRecord>(scope, 'inventory-watch'))
        if (watch.status === 'active' && Date.parse(watch.expiresAt) <= this.clock().getTime()) this.store.update(watch, { status: 'expired' });
    });
  }
  requireActive(watch: InventoryWatch): void {
    if (watch.status !== 'active') throw new Error('WATCH_INACTIVE');
    if (!Number.isFinite(Date.parse(watch.expiresAt)) || Date.parse(watch.expiresAt) <= this.clock().getTime()) throw new Error('WATCH_EXPIRED');
  }
  risk(scope: string, inventoryId: string): RiskSnapshot { return inventoryRisk(this.store, scope, inventoryId); }
  rule(scope: string): InventoryRule | null {
    const row = this.store.list<InventoryRule>(scope, 'inventory-rule')[0];
    if (!row) return null;
    const rule = liveEntity<InventoryRule>(this.store, scope, row.id, 'inventory-rule');
    humanSource(this.store, scope, rule.sourceId); return rule;
  }
  configureRule(scope: string, input: RuleInput, sourceId: string): InventoryRule {
    const requestId = safeText(input.requestId, 100);
    if (!['off', 'observe', 'auto'].includes(input.mode) || !Array.isArray(input.inventoryIds)
      || input.inventoryIds.length > 100 || (input.mode !== 'off' && input.inventoryIds.length === 0)) throw new Error('INVALID_INVENTORY_RULE');
    humanSource(this.store, scope, sourceId);
    const inventoryIds = [...new Set(input.inventoryIds.map(id => safeText(id, 100)))].sort();
    for (const id of inventoryIds) this.risk(scope, id);
    const payload = { mode: input.mode, inventoryIds, sourceId };
    const result = this.store.command(scope, `inventory-rule:${requestId}`, payload, () => {
      const old = this.rule(scope), data = { ...payload, sources: [sourceId, ...inventoryIds] };
      if (old && old.mode === input.mode && JSON.stringify(old.inventoryIds) === JSON.stringify(inventoryIds)) return old;
      return old ? this.store.update(old, data) : this.store.create(scope, 'inventory-rule', data);
    });
    return liveEntity<InventoryRule>(this.store, scope, result.id, 'inventory-rule');
  }
  scan(scope: string): void { scanEvents(this, scope); }
  pending(scope: string): FollowupEvent[] { return pendingEvents(this, scope); }
  markDelivered(scope: string, eventId: string): void {
    this.store.transaction(() => {
      const event = this.store.list<FollowupEvent>(scope, 'followup-event').find(row => row.eventId === eventId);
      if (!event) throw new Error('NOT_FOUND');
      if (event.status === 'delivered') return;
      if (!this.pending(scope).some(row => row.eventId === eventId)) throw new Error('FOLLOWUP_EVENT_STALE');
      this.store.update(event, { status: 'delivered' });
    });
  }
  snapshot(scope: string): FollowupSnapshot {
    let rule: InventoryRule | null;
    try { rule = this.rule(scope); } catch { rule = null; }
    return { watches: this.list(scope), rule, events: this.pending(scope) };
  }
}
