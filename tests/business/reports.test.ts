import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Reports, type ReportInput } from '../../packages/business/operations/reports.ts';
import { forecastVersion } from '../../packages/business/operations/forecast.ts';
test('normalized report identity remains usable by forecasting across the module boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-report-identity-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const reports = new Reports(store);
  try {
    const input: ReportInput = {
      kind: 'sales',
      store: ' S ',
      site: ' US ',
      asOf: '2026-10-25',
      mapping: { date: 'date', listing: 'listing', units: 'units' },
      csv:
        'date,listing,units\n' +
        Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i},A,10`).join('\n'),
    };
    const batch = reports.import('a', input);
    assert.equal(batch.store, 'S');
    assert.equal(reports.import('a', { ...input, store: 'S', site: 'US' }).id, batch.id);
    assert.equal(
      forecastVersion(store, 'a', {
        store: ' S ',
        site: ' US ',
        listing: 'A',
        asOf: input.asOf,
        batchId: batch.id,
        requestId: 'identity',
      }).dailyDemand,
      10,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CSV mapping preserves quoted listing, rejects missing/invalid values and imports a batch idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-reports-'));
  const store = new Store(join(dir, 'business.sqlite'));
  const reports = new Reports(store);
  try {
    const input: ReportInput = {
      kind: 'sales',
      store: '合成店',
      site: 'US',
      asOf: '2026-10-26',
      mapping: { date: '日期', listing: '链接', units: '销量' },
      csv: '日期,链接,销量\r\n2026-10-25,"A,""B""",5\r\n',
    };
    assert.deepEqual(reports.preview(input).rows, [
      { date: '2026-10-25', listing: 'A,"B"', units: 5 },
    ]);
    assert.equal(store.list('a', 'report').length, 0);
    const first = reports.import('a', input);
    assert.equal(first.reportKind, 'sales');
    assert.equal(reports.import('a', input).id, first.id);
    assert.equal(reports.import('b', input).scope, 'b');
    const two = { ...input, csv: '日期,链接,销量\n2026-10-24,B,2\n2026-10-25,A,3' };
    const reversed = { ...two, csv: '日期,链接,销量\n2026-10-25,A,3\n2026-10-24,B,2' };
    assert.equal(reports.import('a', two).id, reports.import('a', reversed).id);
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n,,\n2026-10-25,A,3' }),
      /MISSING_VALUE/,
    );
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n2026-10-25,A,' }),
      /MISSING_VALUE/,
    );
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n2026-02-30,A,2' }),
      /INVALID_DATE/,
    );
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n2026-10-25,A,2\n2026-10-25,A,3' }),
      /DUPLICATE_ROW/,
    );
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n2026-10-25,"A,2' }),
      /INVALID_CSV/,
    );
    assert.throws(
      () => reports.preview({ ...input, csv: '日期,链接,销量\n2026-10-25,A,-2' }),
      /INVALID_NUMBER/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
