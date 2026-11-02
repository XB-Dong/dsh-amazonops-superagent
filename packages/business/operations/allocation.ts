import { Store, type Base, digest } from '../core/store.ts';
import { safeText, quantity } from '../core/validation.ts';
import { calendarDate } from './time.ts';
import type { Inventory } from './inventory.ts';
export type Pool = Base & {
  batchReference?: string;
  physicalSku: string;
  quantity: number;
  windows: { store: string; from: string; to: string }[];
  sources: string[];
};
export type Allocation = Base & {
  poolId: string;
  inventoryId: string;
  physicalSku: string;
  store: string;
  site: string;
  listing: string;
  quantity: number;
  shipDate: string;
  status: string;
  sources: string[];
};
export function createPool(
  store: Store,
  scope: string,
  key: string,
  input: Pick<Pool, 'physicalSku' | 'quantity' | 'windows' | 'batchReference'>,
): Pool {
  input = { ...input, physicalSku: safeText(input.physicalSku, 100) };
  quantity(input.quantity);
  if (!Array.isArray(input.windows) || !input.windows.length || input.windows.length > 50)
    throw new Error('STORE_WINDOW_REQUIRED');
  input.windows = input.windows.map((w) => ({ ...w, store: safeText(w.store, 100) }));
  for (const w of input.windows) {
    calendarDate(w.from);
    calendarDate(w.to);
    if (w.to < w.from) throw new Error('INVALID_STORE_WINDOW');
  }
  const reference = input.batchReference ? safeText(input.batchReference, 100) : safeText(key, 100);
  return store.once(scope, `pool:${digest([input.physicalSku, reference])}`, () => {
    const source = store.source(scope, JSON.stringify(input));
    return store.create(scope, 'pool', {
      ...input,
      batchReference: reference,
      sources: [source.id],
    });
  });
}
export function allocate(
  store: Store,
  scope: string,
  key: string,
  input: {
    poolId: string;
    inventoryId: string;
    quantity: number;
    shipDate: string;
    revision: number;
  },
): Allocation {
  quantity(input.quantity);
  calendarDate(input.shipDate);
  if (input.quantity < 1) throw new Error('INVALID_QUANTITY');
  return store.once(scope, `allocation:${key}`, () => {
    const pool = store.get<Pool>(scope, input.poolId),
      inventory = store.get<Inventory>(scope, input.inventoryId);
    if (
      pool.kind !== 'pool' ||
      inventory.kind !== 'inventory' ||
      pool.physicalSku !== inventory.physicalSku
    )
      throw new Error('POOL_SKU_MISMATCH');
    if (pool.revision !== input.revision) throw new Error('REVISION_CONFLICT');
    if (
      !pool.windows.some(
        (w) => w.store === inventory.store && input.shipDate >= w.from && input.shipDate <= w.to,
      )
    )
      throw new Error('STORE_WINDOW_CLOSED');
    const used = store
      .list<Allocation>(scope, 'allocation')
      .filter((a) => a.poolId === pool.id && a.status !== 'released')
      .reduce((sum, a) => sum + a.quantity, 0);
    if (used + input.quantity > pool.quantity) throw new Error('POOL_EXHAUSTED');
    store.update(pool, {}, input.revision);
    return store.create(scope, 'allocation', {
      poolId: pool.id,
      inventoryId: inventory.id,
      physicalSku: pool.physicalSku,
      store: inventory.store,
      site: inventory.site,
      listing: inventory.listing,
      quantity: input.quantity,
      shipDate: input.shipDate,
      status: 'reserved',
      sources: [pool.id, inventory.id],
    });
  });
}
