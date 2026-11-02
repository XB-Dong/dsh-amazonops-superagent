import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAds, type AdOptions } from '../../packages/business/operations/advertising.ts';
import type { ReportBatch } from '../../packages/business/operations/reports.ts';
const options: AdOptions = { groupBy: 'listing', attributionDays: 7, minClicks: 20, maxACOS: 25 };
const batch = {
  id: 'batch',
  kind: 'report',
  reportKind: 'ads',
  store: 'S',
  site: 'US',
  asOf: '2026-10-25',
  rows: [
    {
      date: '2026-10-01',
      listing: 'A',
      campaign: 'C',
      searchTerm: 'term',
      impressions: 1000,
      clicks: 20,
      spend: 15,
      orders: 2,
      revenue: 60,
      currency: 'USD',
    },
  ],
} as unknown as ReportBatch;
test('budget comparisons are currency-scoped', () => {
  assert.throws(
    () =>
      analyzeAds(batch, { ...options, groupBy: 'campaign', campaignFilter: 'C', dailyBudget: 10 }),
    /BUDGET_CURRENCY_REQUIRED/,
  );
});
test('decimal money is accumulated exactly for budget boundaries', () => {
  const cents = {
    ...batch,
    rows: [
      { ...batch.rows[0], spend: 0.1 },
      { ...batch.rows[0], spend: 0.2 },
    ],
  };
  const [row] = analyzeAds(cents, {
    ...options,
    groupBy: 'campaign',
    campaignFilter: 'C',
    dailyBudget: 0.3,
    budgetCurrency: 'USD',
  });
  assert.equal(row.spend, 0.3);
  assert.ok(!row.suggestions.some((s) => s.includes('每日预算')));
});
test('money projections fail closed when converting micro-units would lose exact precision', () => {
  const edge = {
    ...batch,
    rows: [
      { ...batch.rows[0], spend: 9007199254.74099 },
      { ...batch.rows[0], spend: 0.000001 },
    ],
  };
  assert.throws(() => analyzeAds(edge, options), /MONEY_PRECISION_OR_RANGE/);
});
test('advertising metrics have explicit denominators, isolate currencies and require complete costs for profit', () => {
  const [row] = analyzeAds(batch, options);
  assert.equal(row.ctr, 2);
  assert.equal(row.cpc, 0.75);
  assert.equal(row.cvr, 10);
  assert.equal(row.acos, 25);
  assert.equal(row.roas, 4);
  assert.equal(row.profit, null);
  assert.equal(row.mature, true);
  assert.equal(
    analyzeAds(batch, {
      ...options,
      costBasisComplete: true,
      costPerOrder: 10,
      costCurrency: 'USD',
    })[0].profit,
    25,
  );
  assert.equal(
    analyzeAds(batch, {
      ...options,
      costBasisComplete: true,
      costPerOrder: 10,
      costCurrency: 'EUR',
    })[0].profit,
    null,
  );
  const mixed = { ...batch, rows: [...batch.rows, { ...batch.rows[0], currency: 'EUR' }] };
  assert.equal(analyzeAds(mixed, options).length, 2);
  const zero = {
    ...batch,
    rows: [{ ...batch.rows[0], impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 }],
  };
  const [z] = analyzeAds(zero, options);
  for (const value of [z.ctr, z.cpc, z.cvr, z.acos, z.roas]) assert.equal(value, null);
});
test('immature attribution suppresses action advice and old snapshots cannot mature with wall clock', () => {
  const young = {
    ...batch,
    rows: [{ ...batch.rows[0], date: '2026-10-24', orders: 0, revenue: 0 }],
  };
  const [row] = analyzeAds(young, options);
  assert.equal(row.mature, false);
  assert.deepEqual(row.suggestions, ['归因窗口尚未结束，先更新报表继续观察']);
  assert.throws(() => analyzeAds(batch, { ...options, dailyBudget: 10 }), /BUDGET_SCOPE_REQUIRED/);
  const [budget] = analyzeAds(batch, {
    ...options,
    groupBy: 'campaign',
    campaignFilter: 'C',
    dailyBudget: 10,
    budgetCurrency: 'USD',
  });
  assert.ok(budget.suggestions.some((s) => s.includes('每日预算')));
});
test('same ad group names keep campaign scope, budgets require currency and decimal sums do not invent overspend', () => {
  const duplicate = {
    ...batch,
    rows: [
      { ...batch.rows[0], adGroup: 'Default' },
      { ...batch.rows[0], campaign: 'Other', adGroup: 'Default' },
    ],
  };
  assert.equal(analyzeAds(duplicate, { ...options, groupBy: 'adGroup' }).length, 2);
  const mixed = { ...batch, rows: [...batch.rows, { ...batch.rows[0], currency: 'EUR' }] };
  assert.throws(
    () =>
      analyzeAds(mixed, { ...options, groupBy: 'campaign', campaignFilter: 'C', dailyBudget: 10 }),
    /BUDGET_CURRENCY_REQUIRED/,
  );
  const groups = analyzeAds(mixed, {
    ...options,
    groupBy: 'campaign',
    campaignFilter: 'C',
    dailyBudget: 10,
    budgetCurrency: 'USD',
  });
  assert.ok(
    !groups.find((g) => g.currency === 'EUR')!.suggestions.some((s) => s.includes('每日预算')),
  );
  const cents = {
    ...batch,
    rows: [
      { ...batch.rows[0], spend: 0.1 },
      { ...batch.rows[0], spend: 0.2 },
    ],
  };
  const [row] = analyzeAds(cents, {
    ...options,
    groupBy: 'campaign',
    campaignFilter: 'C',
    dailyBudget: 0.3,
    budgetCurrency: 'USD',
  });
  assert.equal(row.spend, 0.3);
  assert.ok(!row.suggestions.some((s) => s.includes('每日预算')));
});
