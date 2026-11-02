import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { createPool, allocate } from '../../packages/business/operations/allocation.ts';
import { createShipment, updateShipment } from '../../packages/business/operations/shipping.ts';
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
