import { Store, type Base } from '../core/store.ts';
import { digest } from '../core/store.ts';
import { calendarDate } from './time.ts';
import { safeText } from '../core/validation.ts';
import type { ReportBatch } from './reports.ts';
export type Forecast = Base & {
  store: string;
  site: string;
  listing: string;
  asOf: string;
  batchId?: string;
  baselineDaily: number | null;
  dailyDemand: number;
  manualReason: string;
  version: number;
  previousId?: string;
  method: string;
  sources: string[];
};
export type ForecastInput = {
  requestId?: string;
  store: string;
  site: string;
  listing: string;
  asOf: string;
  batchId?: string;
  manualDaily?: number;
  manualReason?: string;
};
export function forecastVersion(store: Store, scope: string, input: ForecastInput): Forecast {
  input = {
    ...input,
    store: safeText(input.store, 100),
    site: safeText(input.site, 30),
    listing: safeText(input.listing, 200),
  };
  calendarDate(input.asOf);
  let baselineDaily: number | null = null;
  if (input.batchId) {
    const batch = store.get<ReportBatch>(scope, input.batchId);
    if (
      batch.kind !== 'report' ||
      batch.reportKind !== 'sales' ||
      batch.store !== input.store ||
      batch.site !== input.site ||
      batch.asOf !== input.asOf
    )
      throw new Error('REPORT_SCOPE_MISMATCH');
    const values = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.parse(input.asOf) - i * 86400000).toISOString().slice(0, 10);
      return batch.rows.find((r) => r.date === date && r.listing === input.listing)?.units;
    });
    if (values.every((v) => typeof v === 'number'))
      baselineDaily = values.reduce<number>((sum, v) => sum + Number(v), 0) / 7;
  }
  if (
    input.manualDaily !== undefined &&
    (!Number.isFinite(input.manualDaily) || input.manualDaily < 0 || input.manualDaily > 1e6)
  )
    throw new Error('INVALID_NUMBER');
  if (input.manualDaily !== undefined && !input.manualReason?.trim())
    throw new Error('MANUAL_REASON_REQUIRED');
  if (input.manualReason) safeText(input.manualReason, 1000);
  if (input.manualDaily === undefined && baselineDaily === null)
    throw new Error('INSUFFICIENT_SALES');
  return store.once(
    scope,
    `forecast:${input.requestId ? safeText(input.requestId, 100) : digest(input)}`,
    () => {
      const old = store
        .list<Forecast>(scope, 'forecast')
        .find(
          (f) => f.store === input.store && f.site === input.site && f.listing === input.listing,
        );
      const source = store.source(scope, JSON.stringify(input));
      return store.create(scope, 'forecast', {
        ...input,
        baselineDaily,
        dailyDemand: input.manualDaily ?? baselineDaily!,
        manualReason: input.manualReason ?? '',
        version: (old?.version ?? 0) + 1,
        previousId: old?.id,
        method: input.manualDaily === undefined ? 'trailing-seven-day-mean' : 'manual-with-reason',
        sources: [source.id, ...(input.batchId ? [input.batchId] : [])],
      });
    },
  );
}
