import { Store, type Base } from '../core/store.ts';
import { safeText } from '../core/validation.ts';
import type { Allocation, Pool } from './allocation.ts';
export type Shipment = Base & {
  allocationId: string;
  physicalSku: string;
  store: string;
  site: string;
  listing: string;
  quantity: number;
  shipDate: string;
  destination: string;
  owner: string;
  prerequisites: boolean[];
  amazonId: string;
  erpId: string;
  received: number;
  status: string;
  sources: string[];
};
export function createShipment(store: Store, scope: string, allocationId: string): Shipment {
  return store.once(scope, `shipment:${allocationId}`, () => {
    const a = store.get<Allocation>(scope, allocationId);
    if (a.kind !== 'allocation' || a.status !== 'reserved')
      throw new Error('ALLOCATION_UNAVAILABLE');
    return store.create(scope, 'shipment', {
      allocationId,
      physicalSku: a.physicalSku,
      store: a.store,
      site: a.site,
      listing: a.listing,
      quantity: a.quantity,
      shipDate: a.shipDate,
      destination: '',
      owner: '',
      prerequisites: [false, false, false, false],
      amazonId: '',
      erpId: '',
      received: 0,
      status: 'draft',
      sources: [a.id],
    });
  });
}
export function updateShipment(
  store: Store,
  scope: string,
  id: string,
  revision: number,
  key: string,
  changes: Partial<Shipment>,
): Shipment {
  return store.once(scope, `shipment-update:${key}`, () => {
    const row = store.get<Shipment>(scope, id);
    if (row.kind !== 'shipment') throw new Error('NOT_FOUND');
    const prerequisites = changes.prerequisites ?? row.prerequisites;
    if (prerequisites.length !== 4 || prerequisites.some((v) => typeof v !== 'boolean'))
      throw new Error('INVALID_PREREQUISITES');
    let status = changes.status ?? row.status;
    const transitions: Record<string, string[]> = {
      draft: ['draft', 'ready', 'cancelled'],
      ready: ['ready', 'in_transit', 'cancelled'],
      in_transit: ['in_transit', 'partially_received', 'received'],
      partially_received: ['partially_received', 'received'],
      received: ['received'],
      cancelled: ['cancelled'],
    };
    if (!transitions[row.status]?.includes(status)) throw new Error('INVALID_SHIPMENT_TRANSITION');
    const normalize = (text: string) => (text ? safeText(text, 200) : '');
    const amazonId = normalize(changes.amazonId ?? row.amazonId),
      erpId = normalize(changes.erpId ?? row.erpId),
      destination = normalize(changes.destination ?? row.destination),
      owner = normalize(changes.owner ?? row.owner);
    if (
      status !== 'draft' &&
      status !== 'cancelled' &&
      (!prerequisites.every(Boolean) || !destination || !owner)
    )
      throw new Error('PREREQUISITES_REQUIRED');
    if (['in_transit', 'partially_received', 'received'].includes(status) && (!amazonId || !erpId))
      throw new Error('DUAL_IDS_REQUIRED');
    const received = changes.received ?? row.received;
    if (
      !Number.isSafeInteger(received) ||
      received < row.received ||
      received > row.quantity ||
      received < 0 ||
      (received > 0 && ['draft', 'ready', 'cancelled'].includes(status))
    )
      throw new Error('INVALID_RECEIPT');
    if (received > 0) status = received === row.quantity ? 'received' : 'partially_received';
    if (
      (status === 'received' && received !== row.quantity) ||
      (status === 'partially_received' && received === 0)
    )
      throw new Error('INVALID_RECEIPT');
    for (const other of store.list<Shipment>(scope, 'shipment'))
      if (
        other.id !== id &&
        ((amazonId && other.amazonId === amazonId) || (erpId && other.erpId === erpId))
      )
        throw new Error('DUPLICATE_EXTERNAL_ID');
    if (status === 'cancelled' && row.status !== 'cancelled') {
      const allocation = store.get<Allocation>(scope, row.allocationId),
        pool = store.get<Pool>(scope, allocation.poolId);
      store.update(allocation, { status: 'released' });
      store.update(pool, {});
    }
    return store.update(
      row,
      { prerequisites, status, amazonId, erpId, destination, owner, received },
      revision,
    );
  });
}
