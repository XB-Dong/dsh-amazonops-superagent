import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { forecastVersion } from '../../packages/business/operations/forecast.ts';
import { saveInventory } from '../../packages/business/operations/inventory.ts';
import { Followups } from '../../packages/business/followups/index.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'amazonops-followups-'));
  const store = new Store(join(dir, 'business.sqlite'));
  let clock = new Date('2026-11-05T00:00:00.000Z');
  const followups = new Followups(store, () => clock);
  const source = store.source('main', 'Follow the synthetic stock plan until tomorrow.');
  const forecast = forecastVersion(store, 'main', { requestId: 'initial', store: 'S', site: 'US', listing: 'A',
    asOf: '2026-11-05', manualDaily: 5, manualReason: 'Synthetic fixture' });
  const inventory = saveInventory(store, 'main', { forecastId: forecast.id, physicalSku: 'SKU-A',
    asOf: '2026-11-05', available: 12, reserved: 0, inbound: [], leadDays: { purchase: 1, transport: 2, receiving: 1 },
    safetyDays: 2, horizon: 7, demandFactors: [] });
  store.appendEvent('main', 'business:inventory', inventory);
  return { dir, store, followups, source, inventory, forecast,
    advance: (iso: string) => { clock = new Date(iso); },
    close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('finite scoped watch validates current source, captures identity and is request-idempotent', () => {
  const f = fixture();
  try {
    const input = { requestId: 'watch-1', inventoryId: f.inventory.id, expiresAt: '2026-11-06T00:00:00.000Z' };
    const watch = f.followups.create('main', input, f.source.id);
    assert.equal(watch.status, 'active');
    assert.equal(watch.listing, 'A');
    assert.equal(f.followups.create('main', input, f.source.id).id, watch.id);
    assert.throws(() => f.followups.create('main', { ...input, title: 'Changed' }, f.source.id), /REQUEST_CONFLICT/);
    assert.throws(() => f.followups.create('other', input, f.source.id), /NOT_FOUND|SOURCE/);
    assert.throws(() => f.followups.create('main', { ...input, requestId: 'past', expiresAt: '2026-11-04T00:00:00.000Z' }, f.source.id), /EXPIRY/);
  } finally { f.close(); }
});

function watch(f: ReturnType<typeof fixture>, requestId = 'watch') {
  return f.followups.create('main', { requestId, inventoryId: f.inventory.id, expiresAt: '2026-11-06T00:00:00.000Z' }, f.source.id);
}
function change(f: ReturnType<typeof fixture>, quantity: number, requestId = `forecast-${quantity}`) {
  const forecast = forecastVersion(f.store, 'main', { requestId, store: 'S', site: 'US', listing: 'A',
    asOf: '2026-11-05', manualDaily: quantity, manualReason: 'Synthetic changed demand' });
  f.store.appendEvent('main', 'business:forecast', forecast);
  return forecast;
}

test('changed risk wakes once, survives restart/replay and can return to the original risk', () => {
  const f = fixture();
  try {
    const w = watch(f);
    f.followups.bindTicket('main', w.id, 'native-ticket');
    assert.equal(f.followups.bindTicket('main', w.id, 'native-ticket').ticketId, 'native-ticket');
    assert.throws(() => f.followups.bindTicket('main', w.id, 'other-ticket'), /TICKET_CONFLICT/);
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
    const forecast = change(f, 8); f.followups.scan('main');
    const event = f.followups.pending('main')[0];
    assert.equal(event.watchId, w.id); assert.equal(event.risk.replenishQuantity, 36);
    f.store.appendEvent('main', 'business:forecast', forecast);
    const restarted = new Followups(f.store, () => new Date('2026-11-05T01:00:00.000Z'));
    restarted.scan('main'); assert.equal(restarted.pending('main').length, 1);
    restarted.markDelivered('main', event.eventId); restarted.markDelivered('main', event.eventId);
    restarted.scan('main'); assert.equal(restarted.pending('main').length, 0);
    change(f, 5, 'return-to-baseline'); f.followups.scan('main');
    assert.equal(f.followups.pending('main').length, 1, 'a changed-back baseline is still a material transition');
  } finally { f.close(); }
});

test('cursor and pending outbox roll back together when durable enqueue fails', () => {
  const f = fixture();
  try {
    watch(f); f.followups.scan('main'); change(f, 9);
    const cursorBefore = f.store.list('main', 'followup-cursor');
    const original = f.store.create.bind(f.store);
    f.store.create = ((scope: string, kind: string, data: object, id?: string) => {
      if (kind === 'followup-event') throw new Error('INJECTED_DURABILITY_FAILURE');
      return original(scope, kind, data, id);
    }) as typeof f.store.create;
    assert.throws(() => f.followups.scan('main'), /INJECTED_DURABILITY_FAILURE/);
    assert.deepEqual(f.store.list('main', 'followup-cursor'), cursorBefore);
    f.store.create = original;
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 1);
  } finally { f.close(); }
});

test('unrelated, stale and derived events do not authorize work or create self triggers', () => {
  const f = fixture();
  try {
    watch(f); f.followups.scan('main');
    const forecast = change(f, 7);
    f.store.db.prepare('DELETE FROM business_events WHERE entity_id=?').run(forecast.id);
    f.store.appendEvent('main', 'business:feedback', forecast);
    f.store.appendEvent('main', 'assistant-receipt', forecast);
    f.store.appendEvent('other', 'business:forecast', forecast);
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
    f.store.appendEvent('main', 'business:forecast', { ...forecast, revision: 0 });
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
    f.store.appendEvent('main', 'business:forecast', forecast); f.followups.scan('main');
    assert.equal(f.followups.pending('main').length, 1);
    const count = f.store.events('main').length;
    for (let i = 0; i < 4; i++) f.followups.scan('main');
    assert.equal(f.store.events('main').length, count);
    assert.equal(f.store.list('main', 'followup-event').length, 1);
    assert.equal(f.followups.pending('other').length, 0);
  } finally { f.close(); }
});

test('stop, expiry and source deletion invalidate pending work and cannot be replayed', () => {
  for (const mode of ['stop', 'expiry', 'delete', 'revoke'] as const) {
    const f = fixture();
    try {
      const w = watch(f); change(f, 8); f.followups.scan('main');
      const event = f.followups.pending('main')[0]; assert.ok(event);
      if (mode === 'stop') {
        assert.throws(() => f.followups.stop('main', w.id, w.revision + 1), /REVISION_CONFLICT/);
        f.followups.stop('main', w.id, w.revision);
      } else if (mode === 'expiry') {
        f.advance('2026-11-06T00:00:00.000Z'); f.followups.expire('main');
        assert.equal(f.followups.get('main', w.id).status, 'expired');
      } else if (mode === 'delete') f.store.remove('main', f.source.id);
      else { f.store.privacyIntent('main', f.source.id, 'revoke'); f.store.applyPrivacyLedger(); }
      assert.equal(f.followups.pending('main').length, 0, mode);
      assert.throws(() => f.followups.markDelivered('main', event.eventId), /NOT_FOUND|STALE/);
      f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
      assert.throws(() => f.followups.bindTicket('main', w.id, 'late-ticket'), /INACTIVE|EXPIRED|NOT_FOUND|DELETED|REVOKED/);
    } finally { f.close(); }
  }
});

test('observe rule creates only an explanatory candidate; off, mode change and active watch are respected', () => {
  const f = fixture();
  try {
    const input = { requestId: 'observe', mode: 'observe' as const, inventoryIds: [f.inventory.id] };
    const rule = f.followups.configureRule('main', input, f.source.id);
    assert.equal(f.followups.configureRule('main', input, f.source.id).id, rule.id);
    f.followups.scan('main');
    const observe = f.followups.pending('main')[0]; assert.equal(observe.eventClass, 'risk_candidate');
    assert.equal(observe.ruleMode, 'observe'); assert.equal(f.store.list('main', 'task').length, 0);
    assert.equal(f.store.list('main', 'inventory-watch').length, 0);
    f.followups.configureRule('main', { ...input, requestId: 'auto', mode: 'auto' }, f.source.id);
    assert.equal(f.followups.pending('main').length, 0, 'old policy candidate is no longer executable');
    f.followups.scan('main'); assert.equal(f.followups.pending('main')[0].ruleMode, 'auto');
    const w = watch(f); assert.equal(f.followups.pending('main').length, 0, 'watch owns the same business responsibility');
    change(f, 7); f.followups.scan('main');
    assert.equal(f.followups.pending('main').length, 1); assert.equal(f.followups.pending('main')[0].watchId, w.id);
    f.followups.configureRule('main', { requestId: 'off', mode: 'off', inventoryIds: [] }, f.source.id);
    f.followups.scan('main'); assert.equal(f.followups.pending('main').every(e => !!e.watchId), true);
  } finally { f.close(); }
});

test('stale risk payload is refused and queued versions coalesce to current facts', () => {
  const f = fixture();
  try {
    watch(f); change(f, 7); f.followups.scan('main');
    const old = f.followups.pending('main')[0];
    change(f, 8); change(f, 9); f.followups.scan('main');
    const pending = f.followups.pending('main');
    assert.equal(pending.length, 1); assert.notEqual(pending[0].eventId, old.eventId);
    assert.equal(pending[0].risk.replenishQuantity, 42);
    assert.throws(() => f.followups.markDelivered('main', old.eventId), /STALE/);
  } finally { f.close(); }
});

test('semantic no-change forecasts and malformed human scope cannot create more work', () => {
  const f = fixture();
  try {
    watch(f); const digest = f.followups.risk('main', f.inventory.id).digest;
    change(f, 5, 'new-version-same-facts'); f.followups.scan('main');
    assert.equal(f.followups.risk('main', f.inventory.id).digest, digest); assert.equal(f.followups.pending('main').length, 0);
    const tool = f.store.create('main', 'source', { origin: 'tool', text: 'Not human authority' });
    assert.throws(() => f.followups.create('main', { requestId: 'tool', inventoryId: f.inventory.id, expiresAt: '2026-11-06T00:00:00Z' }, tool.id), /HUMAN_SOURCE_REQUIRED/);
    assert.throws(() => f.followups.configureRule('other', { requestId: 'cross', mode: 'auto', inventoryIds: [f.inventory.id] }, f.source.id), /NOT_FOUND|SOURCE/);
  } finally { f.close(); }
});

test('closed and reopened database keeps pending input, cursor and native binding without duplicate effects', () => {
  const f = fixture();
  const w = watch(f); f.followups.bindTicket('main', w.id, 'persisted-ticket');
  change(f, 8); f.followups.scan('main'); const identity = f.followups.pending('main')[0].eventId;
  f.store.close();
  const reopened = new Store(join(f.dir, 'business.sqlite'));
  try {
    const service = new Followups(reopened, () => new Date('2026-11-05T01:00:00.000Z'));
    assert.equal(service.get('main', w.id).ticketId, 'persisted-ticket');
    service.scan('main'); assert.equal(service.pending('main').length, 1);
    assert.equal(service.pending('main')[0].eventId, identity);
    service.markDelivered('main', identity); service.scan('main');
    assert.equal(service.pending('main').length, 0);
    assert.equal(reopened.list('main', 'followup-event').length, 1);
  } finally { reopened.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('consumer handles more than one source page and keeps snapshots read-only', () => {
  const f = fixture();
  try {
    watch(f);
    for (let i = 0; i < 215; i++) f.store.appendEvent('main', 'business:feedback', f.source);
    change(f, 8); f.followups.scan('main');
    assert.equal(f.followups.pending('main').length, 1);
    const count = Number(f.store.db.prepare('SELECT total_changes() AS n').get()?.n);
    f.followups.snapshot('main'); f.followups.pending('main'); f.followups.list('main');
    assert.equal(Number(f.store.db.prepare('SELECT total_changes() AS n').get()?.n), count);
  } finally { f.close(); }
});

test('same rule semantics and reenabling a delivered risk window cannot create duplicate auto work', () => {
  const f = fixture();
  try {
    const rule = f.followups.configureRule('main', { requestId: 'auto-first', mode: 'auto', inventoryIds: [f.inventory.id] }, f.source.id);
    f.followups.scan('main'); const event = f.followups.pending('main')[0];
    f.followups.markDelivered('main', event.eventId);
    const repeated = f.followups.configureRule('main', { requestId: 'auto-repeat', mode: 'auto', inventoryIds: [f.inventory.id] }, f.source.id);
    assert.equal(repeated.revision, rule.revision, 'unchanged rule semantics do not create a policy revision');
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
    f.followups.configureRule('main', { requestId: 'off', mode: 'off', inventoryIds: [] }, f.source.id);
    f.followups.configureRule('main', { requestId: 'on-again', mode: 'auto', inventoryIds: [f.inventory.id] }, f.source.id);
    f.followups.scan('main'); assert.equal(f.followups.pending('main').length, 0);
  } finally { f.close(); }
});

test('invalid calendar expiry cannot be accepted', () => {
  const f = fixture();
  try {
    assert.throws(() => f.followups.create('main', { requestId: 'invalid-date', inventoryId: f.inventory.id,
      expiresAt: '2027-02-30T00:00:00.000Z' }, f.source.id), /EXPIRY/);
  } finally { f.close(); }
});

test('mismatched event and referenced entity kinds cannot authorize work', () => {
  const f = fixture();
  try {
    watch(f); f.followups.scan('main'); const forecast = change(f, 8);
    f.store.db.prepare('DELETE FROM business_events WHERE entity_id=?').run(forecast.id);
    f.store.appendEvent('main', 'business:inventory', forecast); f.followups.scan('main');
    assert.equal(f.followups.pending('main').length, 0, 'event kind must agree with trusted entity kind');
  } finally { f.close(); }
});

test('a returned current risk exposes only its latest transition, never older pending copies', () => {
  const f = fixture();
  try {
    watch(f); f.followups.scan('main');
    change(f, 8, 'risk-first'); f.followups.scan('main');
    const old = f.followups.pending('main')[0];
    change(f, 6, 'risk-middle'); f.followups.scan('main');
    change(f, 8, 'risk-returned'); f.followups.scan('main');
    const pending = f.followups.pending('main');
    assert.equal(pending.length, 1);
    assert.ok(pending[0].sequence > old.sequence);
    assert.notEqual(pending[0].eventId, old.eventId);
    assert.throws(() => f.followups.markDelivered('main', old.eventId), /STALE/);
    f.followups.markDelivered('main', pending[0].eventId);
    assert.equal(f.followups.pending('main').length, 0, 'delivering latest must not uncover an old copy');
  } finally { f.close(); }
});

test('reordering equivalent arrival and demand-factor inputs leaves risk identity unchanged', () => {
  const f = fixture();
  try {
    const base = { forecastId: f.forecast.id, physicalSku: 'SKU-A', asOf: '2026-11-05', available: 12,
      reserved: 0, inbound: [{ date: '2026-11-06', quantity: 2 }, { date: '2026-11-07', quantity: 3 }],
      leadDays: { purchase: 1, transport: 2, receiving: 1 }, safetyDays: 2, horizon: 7,
      demandFactors: [{ date: '2026-11-06', multiplier: 2 }, { date: '2026-11-07', multiplier: 3 }] };
    const original = saveInventory(f.store, 'main', base);
    const w = f.followups.create('main', { requestId: 'array-watch', inventoryId: original.id,
      expiresAt: '2026-11-06T00:00:00.000Z' }, f.source.id);
    const before = f.followups.risk('main', original.id);
    const reordered = saveInventory(f.store, 'main', { ...base, inbound: [...base.inbound].reverse(),
      demandFactors: [...base.demandFactors].reverse(), leadDays: { receiving: 1, transport: 2, purchase: 1 } });
    f.store.appendEvent('main', 'business:inventory', reordered);
    const after = f.followups.risk('main', reordered.id);
    assert.equal(after.stockoutDate, before.stockoutDate);
    assert.equal(after.replenishQuantity, before.replenishQuantity);
    assert.equal(after.digest, before.digest);
    f.followups.scan('main'); assert.equal(f.followups.pending('main').filter(e => e.watchId === w.id).length, 0);
  } finally { f.close(); }
});

test('trusted completion checks CAS, persists completed and disallows more pending work', () => {
  const f = fixture();
  try {
    const w = watch(f); change(f, 8); f.followups.scan('main');
    assert.throws(() => f.followups.complete('main', w.id, w.revision + 1), /REVISION_CONFLICT/);
    const completed = f.followups.complete('main', w.id, w.revision);
    assert.equal(completed.status, 'completed');
    assert.equal(f.followups.get('main', w.id).status, 'completed');
    assert.equal(f.followups.complete('main', w.id, completed.revision).revision, completed.revision);
    assert.equal(f.followups.pending('main').length, 0);
    assert.throws(() => f.followups.complete('other', w.id, completed.revision), /NOT_FOUND|DELETED/);
  } finally { f.close(); }
});

test('completion persists expiry before rejecting and rechecks revoked authority', () => {
  for (const mode of ['expiry', 'revoke', 'stopped'] as const) {
    const f = fixture();
    try {
      const w = watch(f);
      if (mode === 'expiry') {
        f.advance('2026-11-06T00:00:00.000Z');
        assert.equal(f.followups.get('main', w.id).status, 'active', 'read does not silently expire');
        assert.throws(() => f.followups.complete('main', w.id, w.revision), /EXPIRED/);
        assert.equal(f.followups.get('main', w.id).status, 'expired');
      } else if (mode === 'revoke') {
        f.store.privacyIntent('main', f.source.id, 'revoke'); f.store.applyPrivacyLedger();
        assert.throws(() => f.followups.complete('main', w.id, w.revision), /REVOKED/);
      } else {
        const stopped = f.followups.stop('main', w.id, w.revision);
        assert.throws(() => f.followups.complete('main', w.id, stopped.revision), /INACTIVE/);
      }
    } finally { f.close(); }
  }
});
