import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { createPool, allocate } from '../../packages/business/operations/allocation.ts';
import { createShipment, updateShipment } from '../../packages/business/operations/shipping.ts';
import { Business } from '../../packages/business/index.ts';

// A10-01/02 Context Map (self-reviewed, f0378b9): command facade routes to the
// existing allocation/shipping services and Store.once transactions. Exercise
// persisted CAS, trusted inherited fields, receipt monotonicity, ID uniqueness,
// cancellation release and rollback. Existing behavior is regression coverage;
// any actual failing invariant is recorded before changing production code.
function shippingFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'amazonops-shipping-acceptance-'));
  const business = new Business(dir), store = business.store;
  const source = store.source('main', 'Synthetic current inventory ownership');
  const inventory = (changes: Record<string, unknown> = {}) => store.create('main', 'inventory', {
    physicalSku: 'SKU-0007', store: 'Store-A', site: 'US', listing: '000123', asOf: '2026-10-26',
    sources: [source.id], ...changes,
  });
  const inv = inventory();
  const pool = createPool(store, 'main', 'fixture-pool', { physicalSku: 'SKU-0007', batchReference: 'BATCH-0042',
    quantity: 10, windows: [{ store: 'Store-A', from: '2026-10-26', to: '2026-10-30' }] });
  const reserve = (requestId: string, changes: Record<string, unknown> = {}) => business.command('main', 'allocate', {
    requestId, poolId: pool.id, inventoryId: inv.id, quantity: 7, shipDate: '2026-10-27',
    revision: store.get('main', pool.id).revision, ...changes,
  }) as import('../../packages/business/operations/allocation.ts').Allocation;
  let initialShipment: import('../../packages/business/operations/shipping.ts').Shipment | undefined;
  const create = () => initialShipment ??= createShipment(store, 'main', reserve('initial-allocation').id);
  const ready = () => {
    const ship = create();
    return updateShipment(store, 'main', ship.id, ship.revision, 'initial-ready', {
      status: 'ready', destination: 'Synthetic destination', owner: 'cc', prerequisites: [true, true, true, true],
    });
  };
  const transit = () => {
    const ship = ready();
    return updateShipment(store, 'main', ship.id, ship.revision, 'initial-transit', {
      status: 'in_transit', amazonId: 'SYN-AMAZON-0042', erpId: 'SYN-ERP-0042',
    });
  };
  const snapshot = () => ({ entities: store.db.prepare('SELECT * FROM entities ORDER BY scope,id').all(),
    receipts: store.db.prepare('SELECT * FROM receipts ORDER BY scope,request_key').all(),
    events: store.db.prepare('SELECT * FROM business_events ORDER BY sequence').all() });
  return { dir, business, store, inv, pool, source, inventory, reserve, create, ready, transit, snapshot,
    close() { business.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('physical pool identity normalizes whitespace without delimiter collisions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pool-'));
  const store = new Store(join(dir, 'business.sqlite'));
  try {
    const base = { quantity: 10, windows: [{ store: 'S', from: '2026-10-26', to: '2026-10-30' }] };
    const a = createPool(store, 'a', 'one', { ...base, physicalSku: 'P', batchReference: 'B' });
    assert.equal(
      createPool(store, 'a', 'two', { ...base, physicalSku: ' P ', batchReference: 'B' }).id,
      a.id,
    );
    const x = createPool(store, 'a', 'three', { ...base, physicalSku: 'X:Y', batchReference: 'Z' });
    assert.notEqual(
      createPool(store, 'a', 'four', { ...base, physicalSku: 'X', batchReference: 'Y:Z' }).id,
      x.id,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('shared pool allocation is scoped, bounded, date-aware and idempotent; shipment enforces prerequisites and receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-ship-'));
  const store = new Store(join(dir, 'business.sqlite'));
  try {
    const inv = store.create('a', 'inventory', {
      physicalSku: 'P',
      store: 'S',
      site: 'US',
      listing: 'A',
    });
    const pool = createPool(store, 'a', 'pool', {
      batchReference: 'SYN-BATCH',
      physicalSku: 'P',
      quantity: 10,
      windows: [{ store: 'S', from: '2026-10-26', to: '2026-10-30' }],
    });
    assert.equal(
      createPool(store, 'a', 'different-request', {
        physicalSku: 'P',
        batchReference: 'SYN-BATCH',
        quantity: 10,
        windows: [{ store: 'S', from: '2026-10-26', to: '2026-10-30' }],
      }).id,
      pool.id,
    );
    const request = {
      poolId: pool.id,
      inventoryId: inv.id,
      quantity: 7,
      shipDate: '2026-10-27',
      revision: pool.revision,
    };
    const first = allocate(store, 'a', 'first', request);
    assert.equal(first.quantity, 7);
    assert.equal(allocate(store, 'a', 'first', request).id, first.id);
    assert.throws(
      () =>
        allocate(store, 'a', 'competing', {
          ...request,
          quantity: 4,
          revision: store.get('a', pool.id).revision,
        }),
      /POOL_EXHAUSTED/,
    );
    assert.throws(
      () =>
        allocate(store, 'a', 'outside', {
          ...request,
          shipDate: '2026-11-01',
          revision: store.get('a', pool.id).revision,
        }),
      /STORE_WINDOW_CLOSED/,
    );
    assert.throws(() => allocate(store, 'b', 'scope', request), /NOT_FOUND/);
    let ship = createShipment(store, 'a', first.id);
    assert.equal(createShipment(store, 'a', first.id).id, ship.id);
    assert.equal(ship.quantity, 7);
    assert.throws(
      () => updateShipment(store, 'a', ship.id, ship.revision, 'ready-early', { status: 'ready' }),
      /PREREQUISITES_REQUIRED/,
    );
    ship = updateShipment(store, 'a', ship.id, ship.revision, 'ready', {
      status: 'ready',
      prerequisites: [true, true, true, true],
      destination: '合成FBA仓',
      owner: 'cc',
    });
    assert.throws(
      () => updateShipment(store, 'a', ship.id, ship.revision, 'no-ids', { status: 'in_transit' }),
      /DUAL_IDS_REQUIRED/,
    );
    ship = updateShipment(store, 'a', ship.id, ship.revision, 'sent', {
      status: 'in_transit',
      amazonId: 'SYN-A',
      erpId: 'SYN-E',
    });
    assert.throws(
      () =>
        updateShipment(store, 'a', ship.id, ship.revision, 'empty-partial', {
          status: 'partially_received',
          received: 0,
        }),
      /INVALID_RECEIPT/,
    );
    assert.throws(
      () => updateShipment(store, 'a', ship.id, ship.revision, 'overflow', { received: 8 }),
      /INVALID_RECEIPT/,
    );
    assert.throws(
      () => updateShipment(store, 'a', ship.id, ship.revision, 'cancel', { status: 'cancelled' }),
      /INVALID_SHIPMENT_TRANSITION/,
    );
    ship = updateShipment(store, 'a', ship.id, ship.revision, 'partial', { received: 3 });
    assert.equal(ship.status, 'partially_received');
    assert.equal(
      updateShipment(store, 'a', ship.id, ship.revision, 'partial', { received: 3 }).id,
      ship.id,
    );
    ship = updateShipment(store, 'a', ship.id, ship.revision, 'received', { received: 7 });
    assert.equal(ship.status, 'received');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('regression A10-01: a competing persisted pool revision is rejected without allocation, receipt or event writes', () => {
  const f = shippingFixture();
  const competing = new Store(join(f.dir, 'business.sqlite'));
  try {
    const staleRevision = competing.get('main', f.pool.id).revision;
    const first = f.reserve('first-writer', { quantity: 3 });
    const before = f.snapshot();
    assert.throws(() => allocate(competing, 'main', 'stale-writer', { poolId: f.pool.id, inventoryId: f.inv.id,
      quantity: 1, shipDate: '2026-10-27', revision: staleRevision }), /REVISION_CONFLICT/);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(competing.get('main', f.pool.id).revision, staleRevision + 1);
    const second = f.reserve('fresh-writer', { quantity: 7 });
    assert.notEqual(first.id, second.id);
    assert.equal(f.store.list('main', 'allocation').length, 2);
    assert.throws(() => f.reserve('over-capacity', { quantity: 1 }), /POOL_EXHAUSTED/);
  } finally { competing.close(); f.close(); }
});

test('regression A10-01: SKU, object kind, store window and inclusive dates are enforced with scoped ownership', () => {
  const f = shippingFixture();
  try {
    const mismatch = f.inventory({ physicalSku: 'DIFFERENT-SKU' });
    const otherStore = f.inventory({ store: 'Store-B' });
    const baseline = f.snapshot();
    for (const [name, changes, error] of [
      ['sku', { inventoryId: mismatch.id }, /POOL_SKU_MISMATCH/],
      ['kind', { inventoryId: f.source.id }, /POOL_SKU_MISMATCH/],
      ['pool-kind', { poolId: f.source.id }, /POOL_SKU_MISMATCH/],
      ['store', { inventoryId: otherStore.id }, /STORE_WINDOW_CLOSED/],
      ['early', { shipDate: '2026-10-25' }, /STORE_WINDOW_CLOSED/],
      ['late', { shipDate: '2026-10-31' }, /STORE_WINDOW_CLOSED/],
    ] as const) {
      assert.throws(() => f.reserve(name, changes), error);
      assert.deepEqual(f.snapshot(), baseline);
    }
    for (const id of [f.inv.id, 'unknown-id']) assert.throws(() => allocate(f.store, 'other', 'scope', {
      inventoryId: id, poolId: f.pool.id, quantity: 1, shipDate: '2026-10-27', revision: f.pool.revision,
    }), /NOT_FOUND/);
    const first = f.reserve('first-day', { quantity: 3, shipDate: '2026-10-26' });
    const last = f.reserve('last-day', { quantity: 7, shipDate: '2026-10-30' });
    assert.equal(first.shipDate, '2026-10-26'); assert.equal(last.shipDate, '2026-10-30');
  } finally { f.close(); }
});

test('regression A10-02: shipment copies every trusted allocation field and source without accepting caller replacements', () => {
  const f = shippingFixture();
  try {
    const a = f.reserve('authoritative-allocation');
    const ship = f.business.command('main', 'shipment', { allocationId: a.id,
      physicalSku: 'forged', store: 'forged', site: 'forged', listing: 'forged', quantity: 999, shipDate: '2099-01-01',
      sources: ['forged-source'] }) as import('../../packages/business/operations/shipping.ts').Shipment;
    for (const key of ['physicalSku', 'store', 'site', 'listing', 'quantity', 'shipDate'] as const) assert.equal(ship[key], a[key]);
    assert.equal(ship.allocationId, a.id); assert.deepEqual(ship.sources, [a.id]);
    assert.deepEqual(a.sources, [f.pool.id, f.inv.id]); assert.deepEqual(f.inv.sources, [f.source.id]);
    assert.deepEqual(ship.prerequisites, [false, false, false, false]);
    assert.equal(ship.received, 0); assert.equal(ship.status, 'draft');
    assert.equal(createShipment(f.store, 'main', a.id).id, ship.id);
    assert.equal(f.store.list('main', 'shipment').length, 1);
    assert.throws(() => createShipment(f.store, 'other', a.id), /NOT_FOUND/);
  } finally { f.close(); }
});

test('regression A10-02: each prerequisite, owner, destination and both external identifiers are required before dispatch', () => {
  const f = shippingFixture();
  try {
    const draft = f.create();
    const baseline = f.snapshot();
    const complete = { status: 'ready', prerequisites: [true, true, true, true], owner: 'cc', destination: 'Synthetic warehouse' };
    const invalid = [
      ...[0, 1, 2, 3].map(index => ({ prerequisites: complete.prerequisites.map((_, slot) => slot !== index) })),
      { owner: '' }, { destination: '' }, { prerequisites: [true, true, true] }, { prerequisites: [true, true, true, 'yes'] },
    ];
    for (const [index, changes] of invalid.entries()) {
      assert.throws(() => updateShipment(f.store, 'main', draft.id, draft.revision, `bad-ready-${index}`,
        { ...complete, ...changes } as never), /PREREQUISITES_REQUIRED|INVALID_PREREQUISITES/);
      assert.deepEqual(f.snapshot(), baseline);
    }
    const ready = updateShipment(f.store, 'main', draft.id, draft.revision, 'ready-valid', complete);
    const readyBaseline = f.snapshot();
    for (const ids of [{ amazonId: 'SYN-A' }, { erpId: 'SYN-E' }, { amazonId: '', erpId: '' }]) {
      assert.throws(() => updateShipment(f.store, 'main', ready.id, ready.revision, 'bad-dispatch',
        { status: 'in_transit', ...ids }), /DUAL_IDS_REQUIRED/);
      assert.deepEqual(f.snapshot(), readyBaseline);
    }
  } finally { f.close(); }
});

test('regression A10-02: either normalized external ID is unique across shipments and rejected changes leave no partial state', () => {
  const f = shippingFixture();
  try {
    const first = f.transit();
    const secondAllocation = f.reserve('second-shipment', { quantity: 3 });
    const second = createShipment(f.store, 'main', secondAllocation.id);
    const baseline = f.snapshot();
    for (const [index, ids] of [
      { amazonId: ` ${first.amazonId} `, erpId: 'OTHER-ERP' },
      { amazonId: 'OTHER-AMAZON', erpId: ` ${first.erpId} ` },
    ].entries()) {
      assert.throws(() => updateShipment(f.store, 'main', second.id, second.revision, `duplicate-${index}`,
        { ...ids, status: 'ready', owner: 'cc', destination: 'Warehouse', prerequisites: [true, true, true, true] }), /DUPLICATE_EXTERNAL_ID/);
      assert.deepEqual(f.snapshot(), baseline);
    }
    const current = updateShipment(f.store, 'main', first.id, first.revision, 'same-own-ids', {
      amazonId: ` ${first.amazonId} `, erpId: ` ${first.erpId} `,
    });
    assert.equal(current.amazonId, first.amazonId); assert.equal(current.erpId, first.erpId);
  } finally { f.close(); }
});

test('regression A10-02: cumulative receipts reject pre-dispatch, regression, nonintegers, overreceipt and invalid terminal transitions', () => {
  const f = shippingFixture();
  try {
    const draft = f.create();
    assert.throws(() => updateShipment(f.store, 'main', draft.id, draft.revision, 'receipt-draft', { received: 1 }), /INVALID_RECEIPT/);
    const ready = f.ready();
    assert.throws(() => updateShipment(f.store, 'main', ready.id, ready.revision, 'receipt-ready', { received: 1 }), /INVALID_RECEIPT/);
    const sent = f.transit();
    let baseline = f.snapshot();
    for (const received of [-1, 0.5, NaN, Infinity, 8]) {
      assert.throws(() => updateShipment(f.store, 'main', sent.id, sent.revision, 'bad-receipt', { received }), /INVALID_RECEIPT/);
      assert.deepEqual(f.snapshot(), baseline);
    }
    const partial = updateShipment(f.store, 'main', sent.id, sent.revision, 'partial-valid', { received: 3 });
    assert.equal(partial.status, 'partially_received');
    baseline = f.snapshot();
    for (const changes of [{ received: 2 }, { received: 0 }, { status: 'cancelled' }]) {
      assert.throws(() => updateShipment(f.store, 'main', partial.id, partial.revision, 'bad-partial', changes), /INVALID_RECEIPT|INVALID_SHIPMENT_TRANSITION/);
      assert.deepEqual(f.snapshot(), baseline);
    }
    const stillPartial = updateShipment(f.store, 'main', partial.id, partial.revision, 'not-complete-by-label', { status: 'received', received: 4 });
    assert.equal(stillPartial.status, 'partially_received', 'a requested label cannot make an incomplete quantity fully received');
    const full = updateShipment(f.store, 'main', stillPartial.id, stillPartial.revision, 'full-valid', { received: 7 });
    assert.equal(full.status, 'received');
    assert.throws(() => updateShipment(f.store, 'main', full.id, full.revision, 'receipt-backwards', { received: 6 }), /INVALID_RECEIPT/);
    assert.throws(() => updateShipment(f.store, 'main', full.id, full.revision, 'transit-backwards', { status: 'in_transit' }), /INVALID_SHIPMENT_TRANSITION/);
  } finally { f.close(); }
});

test('regression A10-02: stale cancellation rolls back release; valid cancellation releases exactly once for full reallocation', () => {
  const f = shippingFixture();
  try {
    const ship = f.ready();
    const baseline = f.snapshot();
    assert.throws(() => updateShipment(f.store, 'main', ship.id, ship.revision - 1, 'stale-cancel', { status: 'cancelled' }), /REVISION_CONFLICT/);
    assert.deepEqual(f.snapshot(), baseline);
    const originalPool = f.store.get('main', f.pool.id);
    const cancelled = updateShipment(f.store, 'main', ship.id, ship.revision, 'cancel-once', { status: 'cancelled' });
    assert.equal(f.store.get<any>('main', ship.allocationId).status, 'released');
    assert.equal(f.store.get('main', f.pool.id).revision, originalPool.revision + 1);
    const released = f.snapshot();
    assert.deepEqual(updateShipment(f.store, 'main', ship.id, ship.revision, 'cancel-once', { status: 'cancelled' }), cancelled);
    assert.deepEqual(f.snapshot(), released);
    updateShipment(f.store, 'main', ship.id, cancelled.revision, 'cancel-again-new-request', { status: 'cancelled' });
    assert.equal(f.store.get('main', f.pool.id).revision, originalPool.revision + 1);
    const next = f.reserve('reuse-released-pool', { quantity: 10 });
    assert.equal(next.quantity, 10);
    assert.throws(() => f.reserve('no-extra-pool', { quantity: 1 }), /POOL_EXHAUSTED/);
  } finally { f.close(); }
});

test('regression A10-01/02: public shipping commands bind payloads and CAS and never trust cross-scope metadata', () => {
  const f = shippingFixture();
  try {
    const input = { requestId: 'stable-allocation', poolId: f.pool.id, inventoryId: f.inv.id, quantity: 7,
      shipDate: '2026-10-27', revision: f.pool.revision };
    const first = f.business.command('main', 'allocate', input) as { id: string };
    assert.deepEqual(f.business.command('main', 'allocate', input), first);
    assert.throws(() => f.business.command('main', 'allocate', { ...input, quantity: 1 }), /REQUEST_CONFLICT/);
    const ship = createShipment(f.store, 'main', first.id);
    const update = { id: ship.id, revision: ship.revision, requestId: 'stable-update', owner: 'cc' };
    const changed = f.business.command('main', 'shipment-update', update);
    assert.deepEqual(f.business.command('main', 'shipment-update', update), changed);
    assert.throws(() => f.business.command('main', 'shipment-update', { ...update, owner: 'different' }), /REQUEST_CONFLICT/);
    assert.throws(() => f.business.command('main', 'shipment-update', { ...update, requestId: 'stale-update' }), /REVISION_CONFLICT/);
    for (const id of [ship.id, 'unknown-shipment']) assert.throws(() => f.business.command('other', 'shipment-update',
      { ...update, id, requestId: 'cross-scope' }), /NOT_FOUND/);
  } finally { f.close(); }
});
