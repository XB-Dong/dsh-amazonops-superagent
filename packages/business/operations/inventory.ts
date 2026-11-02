import { Store, type Base, digest } from '../core/store.ts';
import { quantity, safeText } from '../core/validation.ts';
import { calendarDate } from './time.ts';
import type { Forecast } from './forecast.ts';
export type ProjectionInput = {
  asOf: string;
  available: number;
  reserved: number;
  inbound: { date: string; quantity: number }[];
  leadDays: { purchase: number; transport: number; receiving: number };
  safetyDays: number;
  horizon: number;
  demandFactors: { date: string; multiplier: number }[];
};
export type Inventory = Base &
  ProjectionInput & {
    forecastId: string;
    physicalSku: string;
    store: string;
    site: string;
    listing: string;
    dailyDemand: number;
    projection: ReturnType<typeof projectInventory>;
    sources: string[];
  };
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(calendarDate(date)) + days * 86400000).toISOString().slice(0, 10);
export function projectInventory(input: ProjectionInput, dailyDemand: number) {
  calendarDate(input.asOf);
  quantity(input.available);
  quantity(input.reserved);
  quantity(input.horizon, 180);
  quantity(input.safetyDays, 30);
  if (
    input.horizon < 1 ||
    !Number.isFinite(dailyDemand) ||
    dailyDemand < 0 ||
    dailyDemand > 1e6 ||
    !Array.isArray(input.inbound) ||
    input.inbound.length > 180 ||
    !Array.isArray(input.demandFactors) ||
    input.demandFactors.length > 180
  )
    throw new Error('INVALID_INVENTORY');
  const lead = input.leadDays;
  quantity(lead.purchase, 60);
  quantity(lead.transport, 60);
  quantity(lead.receiving, 60);
  const totalLead = lead.purchase + lead.transport + lead.receiving;
  if (totalLead + input.safetyDays > 180) throw new Error('INVALID_LEAD_TIME');
  for (const arrival of input.inbound) {
    calendarDate(arrival.date);
    quantity(arrival.quantity);
    if (arrival.date < input.asOf) throw new Error('PAST_INBOUND');
  }
  const factors = new Map<string, number>();
  for (const factor of input.demandFactors) {
    calendarDate(factor.date);
    if (
      !Number.isFinite(factor.multiplier) ||
      factor.multiplier < 0 ||
      factor.multiplier > 20 ||
      factors.has(factor.date)
    )
      throw new Error('INVALID_DEMAND_FACTOR');
    factors.set(factor.date, factor.multiplier);
  }
  const days: {
    date: string;
    opening: number;
    arrival: number;
    demand: number;
    closing: number;
    lostDemand: number;
  }[] = [];
  let stock = input.available;
  let stockoutDate: string | null = null;
  const coverDays = Math.max(1, totalLead + input.safetyDays);
  let expected = 0,
    rounded = 0;
  const demands = Array.from({ length: Math.max(input.horizon, coverDays) }, (_, index) => {
    expected += dailyDemand * (factors.get(shiftDate(input.asOf, index)) ?? 1);
    const next = Math.ceil(expected - 1e-9),
      value = next - rounded;
    rounded = next;
    return value;
  });
  for (let index = 0; index < input.horizon; index++) {
    const date = shiftDate(input.asOf, index),
      opening = stock;
    const arrival = input.inbound
        .filter((a) => a.date === date)
        .reduce((sum, a) => sum + a.quantity, 0),
      demand = demands[index];
    const lostDemand = Math.max(0, demand - stock - arrival);
    stock = Math.max(0, stock + arrival - demand);
    if (lostDemand > 0 && !stockoutDate) stockoutDate = date;
    days.push({ date, opening, arrival, demand, closing: stock, lostDemand });
  }
  let cumulative = input.available,
    replenishQuantity = 0,
    urgentGap = 0;
  for (let index = 0; index < coverDays; index++) {
    const date = shiftDate(input.asOf, index);
    cumulative +=
      input.inbound.filter((a) => a.date === date).reduce((s, a) => s + a.quantity, 0) -
      demands[index];
    replenishQuantity = Math.max(replenishQuantity, -cumulative);
    if (index < totalLead) urgentGap = Math.max(urgentGap, -cumulative);
  }
  return {
    days,
    stockoutDate,
    replenishQuantity,
    urgentGap,
    earliestArrivalDate: shiftDate(input.asOf, totalLead),
    lastShipDate: stockoutDate ? shiftDate(stockoutDate, -lead.transport - lead.receiving) : null,
    lastPrepareDate: stockoutDate ? shiftDate(stockoutDate, -totalLead) : null,
    safetyThreshold: Math.ceil(dailyDemand * input.safetyDays),
    lostDemand: days.reduce((sum, d) => sum + d.lostDemand, 0),
    assumptions: [
      '可售库存已经排除预留；预留仅展示，不再次扣减',
      '到货当天先入库再按需求消耗',
      '按累计期望需求向上取整后逐日差分，避免小数日均被每天加一',
      '补货量取覆盖期逐日前缀最大缺口；提前期内缺口需人工加急/调拨，普通运输无法回补已损失销量',
      '活动倍率与提前期为人工假设；已过去的建议日期表示需立即人工处理',
    ],
  };
}
export function saveInventory(
  store: Store,
  scope: string,
  input: ProjectionInput & { forecastId: string; physicalSku: string },
): Inventory {
  const forecast = store.get<Forecast>(scope, input.forecastId);
  if (forecast.kind !== 'forecast' || forecast.asOf > input.asOf)
    throw new Error('INVALID_FORECAST');
  input = { ...input, physicalSku: safeText(input.physicalSku, 100) };
  const projection = projectInventory(input, forecast.dailyDemand);
  return store.once(scope, `inventory:${digest(input)}`, () =>
    store.create(scope, 'inventory', {
      ...input,
      store: forecast.store,
      site: forecast.site,
      listing: forecast.listing,
      dailyDemand: forecast.dailyDemand,
      projection,
      sources: [forecast.id],
    }),
  );
}
