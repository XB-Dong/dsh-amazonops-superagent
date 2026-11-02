import { Store, type Base, digest } from '../core/store.ts';
import type { ReportBatch } from './reports.ts';
import { quantity, safeText } from '../core/validation.ts';
import { shiftDate } from './inventory.ts';
export type AdOptions = {
  groupBy: 'listing' | 'campaign' | 'adGroup' | 'searchTerm';
  attributionDays: number;
  minClicks: number;
  maxACOS: number;
  campaignFilter?: string;
  dailyBudget?: number;
  budgetCurrency?: string;
  costPerOrder?: number;
  costCurrency?: string;
  costBasisComplete?: boolean;
};
export type AdGroup = {
  name: string;
  campaign?: string;
  currency: string;
  latestDate: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  revenue: number;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
  mature: boolean;
  profit: number | null;
  suggestions: string[];
  dailySpend: { date: string; spend: number }[];
};
export type AdAnalysis = Base & {
  batchId: string;
  asOf: string;
  store: string;
  site: string;
  options: AdOptions;
  groups: AdGroup[];
  sources: string[];
};
function money(value: number): bigint {
  const units = Math.round(value * 1e6);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    Number(value.toFixed(6)) !== value ||
    !Number.isSafeInteger(units)
  )
    throw new Error('MONEY_PRECISION_OR_RANGE');
  return BigInt(units);
}
function amount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('MONEY_PRECISION_OR_RANGE');
  const result = Number(value) / 1e6,
    roundTrip = Math.round(result * 1e6);
  if (!Number.isSafeInteger(roundTrip) || BigInt(roundTrip) !== value)
    throw new Error('MONEY_PRECISION_OR_RANGE');
  return result;
}
const addMoney = (a: number, b: number) => amount(money(a) + money(b));
export function analyzeAds(batch: ReportBatch, options: AdOptions): AdGroup[] {
  if (
    batch.kind !== 'report' ||
    batch.reportKind !== 'ads' ||
    !['listing', 'campaign', 'adGroup', 'searchTerm'].includes(options.groupBy)
  )
    throw new Error('INVALID_AD_REPORT');
  quantity(options.attributionDays, 90);
  quantity(options.minClicks, 100000);
  if (
    options.attributionDays < 1 ||
    !Number.isFinite(options.maxACOS) ||
    options.maxACOS < 0 ||
    options.maxACOS > 1000
  )
    throw new Error('INVALID_AD_OPTIONS');
  for (const n of [options.dailyBudget, options.costPerOrder])
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1e9))
      throw new Error('INVALID_AD_OPTIONS');
  if (options.campaignFilter) safeText(options.campaignFilter, 200);
  if (options.costCurrency !== undefined && !/^[A-Z]{3}$/.test(options.costCurrency))
    throw new Error('INVALID_CURRENCY');
  if (
    options.dailyBudget !== undefined &&
    (!options.campaignFilter || options.groupBy !== 'campaign')
  )
    throw new Error('BUDGET_SCOPE_REQUIRED');
  if (options.dailyBudget !== undefined && !/^[A-Z]{3}$/.test(options.budgetCurrency ?? ''))
    throw new Error('BUDGET_CURRENCY_REQUIRED');
  const groups = new Map<string, AdGroup>();
  for (const row of batch.rows) {
    if (options.campaignFilter && row.campaign !== options.campaignFilter) continue;
    if (options.groupBy === 'adGroup' && !row.adGroup) throw new Error('MISSING_AD_GROUP');
    const name = String(row[options.groupBy]),
      currency = String(row.currency),
      key = JSON.stringify([options.groupBy === 'adGroup' ? row.campaign : null, name, currency]);
    let group = groups.get(key);
    if (!group) {
      group = {
        name,
        campaign: options.groupBy === 'adGroup' ? String(row.campaign) : undefined,
        currency,
        latestDate: String(row.date),
        impressions: 0,
        clicks: 0,
        spend: 0,
        orders: 0,
        revenue: 0,
        ctr: null,
        cpc: null,
        cvr: null,
        acos: null,
        roas: null,
        mature: false,
        profit: null,
        suggestions: [],
        dailySpend: [],
      };
      groups.set(key, group);
    }
    for (const field of ['impressions', 'clicks', 'orders'] as const)
      group[field] += Number(row[field]);
    group.spend = addMoney(group.spend, Number(row.spend));
    group.revenue = addMoney(group.revenue, Number(row.revenue));
    if (String(row.date) > group.latestDate) group.latestDate = String(row.date);
    const daily = group.dailySpend.find((d) => d.date === row.date);
    if (daily) daily.spend = addMoney(daily.spend, Number(row.spend));
    else group.dailySpend.push({ date: String(row.date), spend: Number(row.spend) });
  }
  const ratio = (n: number, d: number, percent = false) =>
    d === 0 ? null : (n / d) * (percent ? 100 : 1);
  return [...groups.values()].map((g) => {
    g.ctr = ratio(g.clicks, g.impressions, true);
    g.cpc = ratio(g.spend, g.clicks);
    g.cvr = ratio(g.orders, g.clicks, true);
    g.acos = ratio(g.spend, g.revenue, true);
    g.roas = ratio(g.revenue, g.spend);
    g.mature = shiftDate(g.latestDate, options.attributionDays) <= batch.asOf;
    if (
      options.costBasisComplete === true &&
      options.costPerOrder !== undefined &&
      options.costCurrency === g.currency
    )
      g.profit = amount(
        money(g.revenue) - BigInt(g.orders) * money(options.costPerOrder) - money(g.spend),
      );
    if (!g.mature) g.suggestions = ['归因窗口尚未结束，先更新报表继续观察'];
    else if (g.clicks < options.minClicks) g.suggestions = ['点击样本不足，先积累数据再判断'];
    else {
      if (g.orders === 0 && g.spend > 0)
        g.suggestions.push('有花费无归因订单，请人工核对搜索词相关性与落地页，再判断否词');
      if (g.acos !== null && g.acos > options.maxACOS + 1e-9)
        g.suggestions.push(`ACOS超过人工目标${options.maxACOS}%，请核对利润与出价，再决定是否调整`);
      if (
        options.dailyBudget !== undefined &&
        options.budgetCurrency === g.currency &&
        g.dailySpend.some((d) => money(d.spend) > money(options.dailyBudget!))
      )
        g.suggestions.push('存在单日花费超过人工录入的每日预算，请先核对预算与报表口径');
      if (!g.suggestions.length)
        g.suggestions.push('当前指标未触发人工目标检查，保留观察并核对利润');
    }
    return g;
  });
}
export function saveAdAnalysis(
  store: Store,
  scope: string,
  batchId: string,
  options: AdOptions,
): AdAnalysis {
  const batch = store.get<ReportBatch>(scope, batchId);
  const groups = analyzeAds(batch, options);
  return store.once(scope, `ads:${digest([batchId, options])}`, () =>
    store.create(scope, 'adAnalysis', {
      batchId,
      asOf: batch.asOf,
      store: batch.store,
      site: batch.site,
      options,
      groups,
      sources: [batchId],
    }),
  );
}
