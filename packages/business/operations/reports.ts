import { Store, digest, type Base } from '../core/store.ts';
import { parseCSV } from './csv.ts';
import { calendarDate } from './time.ts';
import { safeText } from '../core/validation.ts';
export type ReportInput = {
  kind: 'sales' | 'ads';
  store: string;
  site: string;
  asOf: string;
  csv: string;
  mapping: Record<string, string>;
};
export type ReportBatch = Base &
  Omit<ReportInput, 'csv' | 'kind'> & {
    reportKind: 'sales' | 'ads';
    rows: Record<string, string | number>[];
    contentHash: string;
    sources: string[];
    warnings: string[];
  };
function normalize(input: ReportInput): ReportInput {
  return { ...input, store: safeText(input.store, 100), site: safeText(input.site, 30) };
}
export class Reports {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  preview(input: ReportInput): {
    rows: Record<string, string | number>[];
    contentHash: string;
    warnings: string[];
  } {
    input = normalize(input);
    if (
      !['sales', 'ads'].includes(input.kind) ||
      !input.mapping ||
      typeof input.mapping !== 'object'
    )
      throw new Error('INVALID_REPORT');
    safeText(input.store, 100);
    safeText(input.site, 30);
    safeText(input.csv, 100000);
    calendarDate(input.asOf);
    const data = parseCSV(input.csv);
    const fields =
      input.kind === 'sales'
        ? ['date', 'listing', 'units']
        : [
            'date',
            'listing',
            'campaign',
            'searchTerm',
            'impressions',
            'clicks',
            'spend',
            'orders',
            'revenue',
            'currency',
          ];
    const numbers = new Set(['units', 'impressions', 'clicks', 'spend', 'orders', 'revenue']);
    if (input.kind === 'ads' && input.mapping.adGroup) fields.push('adGroup');
    const indices = fields.map((f) => data[0].indexOf(input.mapping[f]));
    if (indices.some((i) => i < 0) || new Set(indices).size !== indices.length)
      throw new Error('MISSING_COLUMN');
    const keys = new Set<string>();
    const rows = data.slice(1).map((cells) => {
      const row: Record<string, string | number> = {};
      fields.forEach((field, i) => {
        const value = cells[indices[i]];
        if (!value) throw new Error('MISSING_VALUE');
        if (numbers.has(field)) {
          if (
            !/^\d+(?:\.\d+)?$/.test(value) ||
            !Number.isFinite(Number(value)) ||
            Number(value) > 1e12 ||
            (['units', 'impressions', 'clicks', 'orders'].includes(field) &&
              !Number.isSafeInteger(Number(value)))
          )
            throw new Error('INVALID_NUMBER');
          row[field] = Number(value);
        } else row[field] = safeText(value, 200);
      });
      calendarDate(String(row.date));
      if (String(row.date) > input.asOf) throw new Error('AS_OF_BEFORE_DATA');
      if (row.currency && !/^[A-Z]{3}$/.test(String(row.currency)))
        throw new Error('INVALID_CURRENCY');
      const key = JSON.stringify([
        row.date,
        row.listing,
        row.campaign,
        row.adGroup,
        row.searchTerm,
      ]);
      if (keys.has(key)) throw new Error('DUPLICATE_ROW');
      keys.add(key);
      return row;
    });
    rows.sort((a, b) => {
      const x = JSON.stringify(a),
        y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return {
      rows,
      contentHash: digest({
        reportKind: input.kind,
        store: input.store,
        site: input.site,
        asOf: input.asOf,
        rows,
      }),
      warnings: ['仅使用已确认规范列；日期缺口不代表零销量，真实资料上传需先取得许可。'],
    };
  }
  import(scope: string, input: ReportInput): ReportBatch {
    input = normalize(input);
    const preview = this.preview(input);
    return this.store.once(scope, `report:${preview.contentHash}`, () => {
      const source = this.store.source(
        scope,
        `Report ${input.kind} / ${input.store} / ${input.site} / ${input.asOf} / ${preview.contentHash}`,
      );
      return this.store.create(scope, 'report', {
        reportKind: input.kind,
        store: input.store,
        site: input.site,
        asOf: input.asOf,
        mapping: input.mapping,
        ...preview,
        sources: [source.id],
      });
    });
  }
}
