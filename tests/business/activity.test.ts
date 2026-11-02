import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Activities } from '../../packages/business/operations/activities.ts';
import { zonedInstant } from '../../packages/business/operations/time.ts';

test('site time rejects DST gaps and requires the matching offset for repeated wall times', () => {
  assert.throws(
    () => zonedInstant('2026-03-08T02:30:00-08:00', 'America/Los_Angeles'),
    /SITE_TIME_MISMATCH/,
  );
  assert.throws(
    () => zonedInstant('2026-11-01T01:30:00', 'America/Los_Angeles'),
    /EXPLICIT_OFFSET_REQUIRED/,
  );
  assert.equal(
    zonedInstant('2026-11-01T01:30:00-08:00', 'America/Los_Angeles') -
      zonedInstant('2026-11-01T01:30:00-07:00', 'America/Los_Angeles'),
    3600000,
  );
});
test('activity stages survive restart, due reminders catch up once and cancellation prevents new reminders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-activity-'));
  const path = join(dir, 'business.sqlite');
  let store = new Store(path);
  try {
    let service = new Activities(store);
    const input = {
      title: '合成活动',
      store: '美店',
      listing: 'SKU-A',
      timeZone: 'America/Los_Angeles',
      startAt: '2026-10-26T10:00:00-07:00',
      endAt: '2026-10-27T10:00:00-07:00',
      leadHours: 4,
      offerNote: '人工核对优惠，不推定叠加价格',
    };
    const row = service.create('a', 'same', input);
    assert.throws(
      () => service.create('a', 'short', { ...input, endAt: '2026-10-26T10:05:00-07:00' }),
      /INVALID_ACTIVITY/,
    );
    assert.equal(row.stages.length, 4);
    assert.equal(service.create('a', 'same', input).id, row.id);
    assert.equal(store.list('a', 'task').length, 4);
    service.tick('a', Date.parse('2026-10-26T17:00:00Z'));
    assert.equal(store.list('a', 'reminder').length, 2);
    store.close();
    store = new Store(path);
    service = new Activities(store);
    service.tick('a', Date.parse('2026-10-26T17:00:00Z'));
    assert.equal(store.list('a', 'reminder').length, 2);
    assert.equal(store.list('b', 'activity').length, 0);
    service.cancel('a', row.id, row.revision);
    service.tick('a', Date.parse('2026-10-30T17:00:00Z'));
    assert.equal(store.list('a', 'reminder').length, 2);
    assert.ok(store.list<any>('a', 'task').every((t) => t.status === 'cancelled'));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
