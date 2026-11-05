import { Store, digest, type Base, type Source } from '../core/store.ts';
import { projectInventory, type Inventory } from '../operations/inventory.ts';
import type { Forecast } from '../operations/forecast.ts';
import type { RiskSnapshot } from '../../contracts/followups.ts';

export function liveEntity<T extends Base>(store: Store, scope: string, id: string, kind?: string,
  seen = new Set<string>()): T {
  if (typeof id !== 'string' || !id || store.isDeleted(scope, id)) throw new Error('SOURCE_DELETED');
  const entity = store.get<T & { status?: string; sources?: unknown }>(scope, id);
  if (entity.scope !== scope || (kind && entity.kind !== kind)) throw new Error('INVALID_REFERENCE');
  if (entity.status === 'revoked' || entity.status === 'withdrawn') throw new Error('DERIVATION_REVOKED');
  if (seen.has(id)) return entity;
  seen.add(id);
  if (entity.sources !== undefined) {
    if (!Array.isArray(entity.sources) || entity.sources.some(value => typeof value !== 'string')) throw new Error('INVALID_REFERENCE');
    for (const source of entity.sources) liveEntity(store, scope, source, undefined, seen);
  }
  return entity;
}
export function humanSource(store: Store, scope: string, id: string): Source {
  const source = liveEntity<Source>(store, scope, id, 'source');
  if (source.origin !== 'user') throw new Error('HUMAN_SOURCE_REQUIRED');
  return source;
}
export function sameInventory(left: Pick<Inventory, 'store' | 'site' | 'listing' | 'physicalSku'>,
  right: Pick<Inventory, 'store' | 'site' | 'listing' | 'physicalSku'>): boolean {
  return left.store === right.store && left.site === right.site && left.listing === right.listing && left.physicalSku === right.physicalSku;
}
export function inventoryRisk(store: Store, scope: string, inventoryId: string): RiskSnapshot {
  const original = liveEntity<Inventory>(store, scope, inventoryId, 'inventory');
  const latest = store.list<Inventory>(scope, 'inventory').filter(candidate => sameInventory(original, candidate)
    && candidate.asOf >= original.asOf).sort((a, b) => b.asOf.localeCompare(a.asOf))[0] ?? original;
  const inventory = liveEntity<Inventory>(store, scope, latest.id, 'inventory');
  const storedForecast = liveEntity<Forecast>(store, scope, inventory.forecastId, 'forecast');
  if (storedForecast.store !== inventory.store || storedForecast.site !== inventory.site || storedForecast.listing !== inventory.listing) throw new Error('INVALID_FORECAST');
  const candidate = store.list<Forecast>(scope, 'forecast').filter(row => row.store === inventory.store
    && row.site === inventory.site && row.listing === inventory.listing && row.asOf <= inventory.asOf)
    .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.version - a.version)[0] ?? storedForecast;
  const forecast = liveEntity<Forecast>(store, scope, candidate.id, 'forecast');
  const projection = projectInventory(inventory, forecast.dailyDemand);
  const facts = { store: inventory.store, site: inventory.site, listing: inventory.listing, physicalSku: inventory.physicalSku,
    asOf: inventory.asOf, available: inventory.available, reserved: inventory.reserved,
    inbound: inventory.inbound.map(row => ({ date: row.date, quantity: row.quantity }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.quantity - b.quantity),
    leadDays: { purchase: inventory.leadDays.purchase, transport: inventory.leadDays.transport, receiving: inventory.leadDays.receiving },
    safetyDays: inventory.safetyDays, horizon: inventory.horizon,
    demandFactors: inventory.demandFactors.map(row => ({ date: row.date, multiplier: row.multiplier }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    dailyDemand: forecast.dailyDemand, stockoutDate: projection.stockoutDate,
    replenishQuantity: projection.replenishQuantity, lostDemand: projection.lostDemand };
  return { inventoryId: inventory.id, forecastId: forecast.id, store: inventory.store, site: inventory.site,
    listing: inventory.listing, physicalSku: inventory.physicalSku, stockoutDate: projection.stockoutDate,
    replenishQuantity: projection.replenishQuantity, sourceIds: [...new Set([original.id, inventory.id, forecast.id, ...inventory.sources, ...forecast.sources])],
    digest: digest(facts), summary: `${inventory.store} / ${inventory.site} / ${inventory.listing}：预计缺货日 ${projection.stockoutDate ?? '无'}，建议补货 ${projection.replenishQuantity} 件。` };
}
