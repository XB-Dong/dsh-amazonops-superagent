/** Synthetic payloads checked against legacy operations/learning schemas and server/chat.ts. */
import { createHash } from 'node:crypto';
import type { Base, Task, ReportBatch, Forecast, Inventory, Pool, Allocation, Shipment,
  AdAnalysis, Activity, Note, Feedback, Memory, Skill, Conversation } from '../../../packages/contracts/model.ts';

const base = (kind: string, id: string, revision = 3): Base => ({ id, kind, scope: 'main', revision,
  createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function legacyBusinessPayloads() {
  const location = { store: 'Synthetic store', site: 'IT', listing: '000123' };
  const source = ['source-retained'];
  const sales: ReportBatch = { ...base('report', 'report-sales'), reportKind: 'sales', store: location.store,
    site: location.site, asOf: '2025-01-07', mapping: { date: 'Date', listing: 'SKU', units: 'Units' },
    rows: Array.from({ length: 7 }, (_, i) => ({ date: `2025-01-0${i + 1}`, listing: '000123', units: 2 })),
    contentHash: '', sources: source, warnings: ['仅使用已确认规范列；日期缺口不代表零销量，真实资料上传需先取得许可。'] };
  sales.contentHash = digest({ reportKind: sales.reportKind, store: sales.store, site: sales.site, asOf: sales.asOf, rows: sales.rows });
  const ads: ReportBatch = { ...base('report', 'report-ads'), reportKind: 'ads', store: location.store,
    site: location.site, asOf: '2025-01-15', mapping: { date: 'Date', listing: 'SKU', campaign: 'Campaign',
      searchTerm: 'Term', impressions: 'Impressions', clicks: 'Clicks', spend: 'Spend', orders: 'Orders', revenue: 'Revenue', currency: 'Currency' },
    rows: [{ date: '2025-01-07', listing: '000123', campaign: 'Synthetic campaign', searchTerm: 'Synthetic term',
      impressions: 1000, clicks: 20, spend: 15, orders: 2, revenue: 60, currency: 'EUR' }],
    contentHash: '', sources: source, warnings: sales.warnings };
  ads.contentHash = digest({ reportKind: ads.reportKind, store: ads.store, site: ads.site, asOf: ads.asOf, rows: ads.rows });
  const forecast: Forecast = { ...base('forecast', 'forecast-retained'), ...location, asOf: sales.asOf,
    batchId: sales.id, baselineDaily: 2, dailyDemand: 2, manualReason: '', version: 1,
    method: 'trailing-seven-day-mean', sources: [...source, sales.id] };
  const inventory: Inventory = { ...base('inventory', 'inventory-retained'), ...location,
    forecastId: forecast.id, physicalSku: 'SYNTHETIC-SKU', asOf: sales.asOf, available: 4, reserved: 1,
    inbound: [{ date: '2025-01-09', quantity: 2 }], leadDays: { purchase: 1, transport: 1, receiving: 0 },
    safetyDays: 1, horizon: 3, demandFactors: [], dailyDemand: 2, sources: [forecast.id],
    projection: { days: [
      { date: '2025-01-07', opening: 4, arrival: 0, demand: 2, closing: 2, lostDemand: 0 },
      { date: '2025-01-08', opening: 2, arrival: 0, demand: 2, closing: 0, lostDemand: 0 },
      { date: '2025-01-09', opening: 0, arrival: 2, demand: 2, closing: 0, lostDemand: 0 },
    ], stockoutDate: null, replenishQuantity: 0, urgentGap: 0, earliestArrivalDate: '2025-01-09',
    lastShipDate: null, lastPrepareDate: null, safetyThreshold: 2, lostDemand: 0, assumptions: [
      '可售库存已经排除预留；预留仅展示，不再次扣减', '到货当天先入库再按需求消耗',
      '按累计期望需求向上取整后逐日差分，避免小数日均被每天加一',
      '补货量取覆盖期逐日前缀最大缺口；提前期内缺口需人工加急/调拨，普通运输无法回补已损失销量',
      '活动倍率与提前期为人工假设；已过去的建议日期表示需立即人工处理',
    ] } };
  const pool: Pool = { ...base('pool', 'pool-retained', 4), physicalSku: inventory.physicalSku, quantity: 30,
    batchReference: 'SYNTHETIC-BATCH', windows: [{ store: location.store, from: '2025-01-01', to: '2025-01-31' }], sources: source };
  const allocation: Allocation = { ...base('allocation', 'allocation-retained'), ...location,
    poolId: pool.id, inventoryId: inventory.id, physicalSku: pool.physicalSku, quantity: 10,
    shipDate: '2025-01-08', status: 'reserved', sources: [pool.id, inventory.id] };
  const shipment: Shipment = { ...base('shipment', 'shipment-retained', 5), ...location,
    allocationId: allocation.id, physicalSku: pool.physicalSku, quantity: 10, shipDate: allocation.shipDate,
    destination: 'Synthetic warehouse', owner: 'Synthetic operator', prerequisites: [true, true, true, true],
    amazonId: 'SYNTHETIC-AMZ', erpId: 'SYNTHETIC-ERP', received: 4, status: 'partially_received', sources: [allocation.id] };
  const analysis: AdAnalysis = { ...base('adAnalysis', 'analysis-retained'), batchId: ads.id,
    asOf: ads.asOf, store: location.store, site: location.site,
    options: { groupBy: 'listing', attributionDays: 7, minClicks: 20, maxACOS: 30 }, sources: [ads.id],
    groups: [{ name: '000123', currency: 'EUR', latestDate: '2025-01-07', impressions: 1000, clicks: 20,
      spend: 15, orders: 2, revenue: 60, ctr: 2, cpc: 0.75, cvr: 10, acos: 25, roas: 4,
      mature: true, profit: null, suggestions: ['当前指标未触发人工目标检查，保留观察并核对利润'],
      dailySpend: [{ date: '2025-01-07', spend: 15 }] }] };
  const stages = [ ['准备', '2025-01-08T03:00:00.000Z'], ['开始切换', '2025-01-08T09:00:00.000Z'],
    ['检查生效', '2025-01-08T09:15:00.000Z'], ['结束恢复', '2025-01-09T09:00:00.000Z'] ];
  const stageTasks: Task[] = stages.map(([name, dueAt], i) => ({ ...base('task', `activity-task-${i}`),
    title: `Synthetic activity · ${name}`, timeZone: 'Europe/Rome', dueAt, status: 'open',
    checklist: [`${name}：人工核对 ${location.store} / ${location.listing}`, '核对新旧优惠、记录实际结果'],
    checked: [false, false], confirmedSuccess: false, sources: source }));
  const activity: Activity = { ...base('activity', 'activity-retained'), title: 'Synthetic activity',
    store: location.store, listing: location.listing, timeZone: 'Europe/Rome', startAt: '2025-01-08T10:00',
    endAt: '2025-01-09T10:00', leadHours: 6, offerNote: 'Synthetic internal plan', status: 'planned', sources: source,
    stages: stages.map(([name, dueAt], i) => ({ name, dueAt, taskId: stageTasks[i].id })) };
  const note: Note = { ...base('note', 'note-retained'), title: 'Synthetic legacy note', content: 'Exact plain text\nSecond line' };
  const feedback: Feedback = { ...base('feedback', 'feedback-retained'), text: 'Synthetic suggestion', page: 'inventory',
    expected: 'Sort by stockout', actual: 'Manual sorting', count: 2, status: 'accepted', sources: source,
    amendments: [{ text: 'Preserve manual ordering too', sourceId: source[0], createdAt: '2025-01-02T00:00:00Z' }] };
  const memory: Memory = { ...base('memory', 'memory-retained'), text: 'Synthetic confirmed fact', key: 'warehouse',
    value: 'Synthetic warehouse', status: 'confirmed', sources: source };
  const skill: Skill = { ...base('skill', 'skill-retained'), name: 'Synthetic workflow', description: 'Synthetic saved process',
    status: 'active', risk: 'low', sources: source, tools: [], steps: ['Inspect synthetic report'], content: 'Synthetic workflow content',
    hash: createHash('sha256').update('Synthetic workflow content').digest('hex'), validation: [] };
  const reminder = { ...base('reminder', 'reminder-retained'), activityId: activity.id, taskId: stageTasks[0].id,
    title: stageTasks[0].title, dueAt: stageTasks[0].dueAt!, timeZone: 'Europe/Rome', read: false, sources: source };
  const conversation: Conversation = { ...base('conversation', 'legacy-conversation'), title: 'Synthetic legacy CC conversation',
    nativeId: 'legacy-cc-runtime-id', messages: [{ role: 'user', text: 'Synthetic archived request' },
      { role: 'assistant', text: 'Synthetic archived response', status: 'done' }] };
  const summary = { ...base('summary', 'legacy-summary'), summary: 'Synthetic legacy facts', factHash: digest(['synthetic']),
    sourceIds: source, factIds: [memory.id] };
  return { retained: [sales, ads, forecast, inventory, pool, allocation, shipment, analysis, activity,
    note, feedback, memory, skill, reminder, ...stageTasks] as Base[],
    histories: [conversation, summary] as Base[], sales, ads, forecast, inventory, pool, allocation, shipment,
    analysis, activity, note, feedback, memory, skill, reminder, conversation, summary, stageTasks };
}
