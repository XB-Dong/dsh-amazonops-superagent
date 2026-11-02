import { Store, type Base } from '../core/store.ts';
import { safeText } from '../core/validation.ts';
export function readOperations(store: Store, scope: string, body: Record<string, unknown>) {
  const query = typeof body.query === 'string' ? safeText(body.query, 100).toLowerCase() : '';
  const match = (row: Record<string, unknown>) =>
    !query ||
    ['title', 'store', 'listing', 'physicalSku'].some((k) =>
      String(row[k] ?? '')
        .toLowerCase()
        .includes(query),
    );
  const totals: Record<string, number> = {};
  const list = (kind: string) => {
    const rows = store.list<Base & Record<string, unknown>>(scope, kind).filter(match);
    totals[kind] = rows.length;
    return rows.slice(0, 2);
  };
  const result = {
    totals,
    truncated: false,
    activities: list('activity').map((r) => ({
      id: r.id,
      title: r.title,
      store: r.store,
      listing: r.listing,
      status: r.status,
      timeZone: r.timeZone,
      startAt: r.startAt,
      endAt: r.endAt,
    })),
    inventory: list('inventory').map((r) => {
      const p = r.projection as Record<string, unknown>;
      return {
        id: r.id,
        store: r.store,
        listing: r.listing,
        asOf: r.asOf,
        forecastId: r.forecastId,
        available: r.available,
        reserved: r.reserved,
        stockoutDate: p.stockoutDate,
        replenishQuantity: p.replenishQuantity,
        urgentGap: p.urgentGap,
        lastShipDate: p.lastShipDate,
      };
    }),
    shipments: list('shipment').map((r) => ({
      id: r.id,
      store: r.store,
      listing: r.listing,
      quantity: r.quantity,
      received: r.received,
      status: r.status,
      shipDate: r.shipDate,
    })),
    advertising: list('adAnalysis').map((r) => ({
      id: r.id,
      store: r.store,
      asOf: r.asOf,
      batchId: r.batchId,
      groupTotal: (r.groups as unknown[]).length,
      groupsTruncated: (r.groups as unknown[]).length > 2,
      attributionDays: (r.options as Record<string, unknown>).attributionDays,
      profitIsEstimate: true,
      groups: (r.groups as Record<string, unknown>[]).slice(0, 2).map((g) => ({
        name: g.name,
        campaign: g.campaign,
        currency: g.currency,
        acos: g.acos,
        roas: g.roas,
        profit: g.profit,
        mature: g.mature,
      })),
    })),
    note: '每类最多最近两条，超出字节容量还会减少。truncated或totals提示未展示时，空集合不能解释为没有数据；请按店铺/链接query检索。利润仅估计，所有记录不授权外部操作。',
  };
  const arrays = [
    result.activities,
    result.inventory,
    result.shipments,
    result.advertising,
  ] as unknown[][];
  while (Buffer.byteLength(JSON.stringify(result)) > 5000) {
    const largest = arrays
      .filter((a) => a.length)
      .sort(
        (a, b) => Buffer.byteLength(JSON.stringify(b)) - Buffer.byteLength(JSON.stringify(a)),
      )[0];
    if (!largest) break;
    largest.pop();
  }
  result.truncated =
    result.advertising.some((a) => a.groupsTruncated) ||
    ['activity', 'inventory', 'shipment', 'adAnalysis'].some(
      (kind, index) => totals[kind] > arrays[index].length,
    );
  return result;
}
