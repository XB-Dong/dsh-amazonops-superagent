import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { forecastVersion } from '../../packages/business/operations/forecast.ts';
import { projectInventory, type ProjectionInput } from '../../packages/business/operations/inventory.ts';
test('forecast refuses missing days, keeps baseline when corrected and versions weekly inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-inv-'));
  const store = new Store(join(dir, 'business.sqlite'));
  try {
    const batch = store.create('a', 'report', {
      reportKind: 'sales',
      store: 'S',
      site: 'US',
      asOf: '2026-10-25',
      rows: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-10-${19 + i}`,
        listing: 'A',
        units: 10 + i,
      })),
    });
    const input = { store: 'S', site: 'US', listing: 'A', asOf: '2026-10-25', batchId: batch.id };
    const original = forecastVersion(store, 'a', input);
    assert.equal(original.dailyDemand, 13);
    assert.equal(original.baselineDaily, 13);
    const revised = forecastVersion(store, 'a', {
      ...input,
      manualDaily: 20,
      manualReason: '活动调整',
    });
    const reverted = forecastVersion(store, 'a', {
      ...input,
      manualDaily: 13,
      manualReason: '恢复均值',
      requestId: 'revert-action',
    });
    assert.equal(reverted.version, 3);
    assert.equal(revised.baselineDaily, 13);
    assert.equal(revised.dailyDemand, 20);
    assert.equal(revised.previousId, original.id);
    assert.equal(revised.version, 2);
    assert.equal(
      forecastVersion(store, 'a', { ...input, manualDaily: 20, manualReason: '活动调整' }).id,
      revised.id,
    );
    assert.throws(
      () => forecastVersion(store, 'a', { ...input, listing: 'MISSING' }),
      /INSUFFICIENT_SALES/,
    );
    assert.throws(
      () => forecastVersion(store, 'a', { ...input, manualDaily: 0 }),
      /MANUAL_REASON_REQUIRED/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('daily inventory excludes reserved twice, models dated arrivals and losses and returns actionable dates', () => {
  const input: ProjectionInput = {
    asOf: '2026-10-26',
    available: 20,
    reserved: 50,
    inbound: [{ date: '2026-10-28', quantity: 10 }],
    leadDays: { purchase: 1, transport: 2, receiving: 1 },
    safetyDays: 2,
    horizon: 7,
    demandFactors: [],
  };
  const result = projectInventory(input, 10);
  assert.equal(result.days[0].opening, 20);
  assert.equal(result.days[1].closing, 0);
  assert.equal(result.days[2].arrival, 10);
  assert.equal(result.stockoutDate, '2026-10-29');
  assert.equal(result.days[3].lostDemand, 10);
  assert.equal(result.replenishQuantity, 30);
  assert.equal(result.lastShipDate, '2026-10-26');
  assert.equal(result.lastPrepareDate, '2026-10-25');
  assert.equal(projectInventory(input, 0).stockoutDate, null);
  assert.throws(
    () => projectInventory({ ...input, inbound: [{ date: '2026-10-25', quantity: 1 }] }, 10),
    /PAST_INBOUND/,
  );
  assert.equal(
    projectInventory({ ...input, demandFactors: [{ date: '2026-10-26', multiplier: 3 }] }, 10)
      .stockoutDate,
    '2026-10-26',
  );
  const late = projectInventory(
    {
      ...input,
      available: 0,
      inbound: [{ date: '2026-10-28', quantity: 30 }],
      leadDays: { purchase: 0, transport: 1, receiving: 0 },
      safetyDays: 2,
    },
    10,
  );
  assert.equal(late.replenishQuantity, 20);
  const fractional = projectInventory(
    {
      ...input,
      available: 1,
      inbound: [],
      leadDays: { purchase: 0, transport: 1, receiving: 0 },
      safetyDays: 6,
    },
    1 / 7,
  );
  assert.equal(
    fractional.days.reduce((s, d) => s + d.demand, 0),
    1,
  );
  assert.equal(fractional.stockoutDate, null);
});
test('fractional daily mean does not invent units on every day', () => {
  const result = projectInventory(
    {
      asOf: '2026-10-26',
      available: 1,
      reserved: 0,
      inbound: [],
      leadDays: { purchase: 0, transport: 1, receiving: 0 },
      safetyDays: 6,
      horizon: 7,
      demandFactors: [],
    },
    1 / 7,
  );
  assert.equal(
    result.days.reduce((s, d) => s + d.demand, 0),
    1,
  );
});
