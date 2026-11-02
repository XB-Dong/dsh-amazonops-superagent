import { useState, type FormEvent } from 'react';
import { type Snapshot, requestId } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import { Badge, Empty } from './components.tsx';
import { siteLabel } from './display.ts';
import { SitePicker } from './SitePicker.tsx';

const pairs = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split('\n')
    .filter((s) => s.trim())
    .map((s) => s.split(',').map((c) => c.trim()));
export function InventoryPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [forecastId, setForecast] = useState('');
  const [localError, setLocalError] = useState('');
  const [site, setSite] = useState('US');
  async function forecast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const input = {
      requestId: requestId(),
      store: String(v.get('store')),
      site: String(v.get('site')),
      listing: String(v.get('listing')),
      asOf: String(v.get('asOf')),
      batchId: v.get('batchId') || undefined,
      manualDaily: v.get('manualDaily') === '' ? undefined : Number(v.get('manualDaily')),
      manualReason: v.get('manualReason') || undefined,
    };
    await mutate('forecast', input);
  }
  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    setLocalError('');
    try {
      await mutate('inventory', {
        forecastId,
        physicalSku: v.get('physicalSku'),
        asOf: v.get('asOf'),
        available: Number(v.get('available')),
        reserved: Number(v.get('reserved')),
        horizon: Number(v.get('horizon')),
        safetyDays: Number(v.get('safetyDays')),
        leadDays: {
          purchase: Number(v.get('purchase')),
          transport: Number(v.get('transport')),
          receiving: Number(v.get('receiving')),
        },
        inbound: pairs(v.get('inbound')).map(([date, q]) => ({ date, quantity: Number(q) })),
        demandFactors: pairs(v.get('factors')).map(([date, q]) => ({
          date,
          multiplier: Number(q),
        })),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '推演未完成');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">提前安排，心里有数</span>
          <h1>库存补货</h1>
          <p>先确认预测与口径，再推演到货、缺货和补货时间。</p>
        </div>
        <Badge>内部建议 · 人工决定</Badge>
      </div>
      <form className="panel form-grid" onSubmit={(e) => void forecast(e).catch(() => {})}>
        <h2 className="wide">每周销量预测</h2>
        <label>
          店铺
          <input name="store" required maxLength={100} />
        </label>
        <SitePicker value={site} onChange={setSite} name="site" />
        <label>
          链接或商品编码
          <input name="listing" required maxLength={200} />
        </label>
        <label>
          数据截至
          <input type="date" name="asOf" required />
        </label>
        <label className="wide">
          销量批次
          <select name="batchId">
            <option value="">不选批次，明确填写人工需求</option>
            {data.reports
              .filter((r) => r.reportKind === 'sales')
              .map((r) => (
                <option value={r.id} key={r.id}>
                  {r.store} · {siteLabel(r.site)} · {r.asOf} · 第{data.reports.indexOf(r) + 1}份报表
                </option>
              ))}
          </select>
        </label>
        <label>
          人工日需求（件，可选）
          <input name="manualDaily" type="number" min="0" max="1000000" step="0.01" />
        </label>
        <label>
          修正或人工估计原因
          <input name="manualReason" maxLength={1000} />
        </label>
        <p className="wide">
          基线使用截至日期连续7日均值。缺失日期需补齐，或填写人工需求；人工覆盖保留原始基线。
        </p>
        <div className="form-actions wide">
          <button disabled={busy} className="primary">
            保存预测新版本
          </button>
        </div>
      </form>
      {data.forecasts.map((f) => (
        <section className="panel" key={f.id}>
          <div className="page-heading">
            <div>
              <h3>
                {f.store} · {f.listing}
              </h3>
              <p>
                {siteLabel(f.site)} · 截至 {f.asOf} · 第{f.version}版
              </p>
            </div>
            <Badge>
              {Date.now() - Date.parse(f.asOf) >= 7 * 86400000 ? '本周需更新' : '预测已记录'}
            </Badge>
          </div>
          <p>
            日需求 {f.dailyDemand.toFixed(2)} 件 · 原始基线{' '}
            {f.baselineDaily === null ? '数据不足' : f.baselineDaily.toFixed(2)}
          </p>
          <p>{f.manualReason || '连续7日均值，未人工覆盖'}</p>
        </section>
      ))}
      <form className="panel form-grid" onSubmit={(e) => void simulate(e)}>
        <h2 className="wide">按日库存推演</h2>
        <label className="wide">
          预测版本
          <select value={forecastId} required onChange={(e) => setForecast(e.target.value)}>
            <option value="">请选择</option>
            {data.forecasts.map((f) => (
              <option value={f.id} key={f.id}>
                {f.store} / {f.listing} / 第{f.version}版 / {f.asOf}
              </option>
            ))}
          </select>
        </label>
        <label>
          实物商品编码
          <input name="physicalSku" required maxLength={100} />
        </label>
        <label>
          库存快照日期
          <input name="asOf" type="date" required />
        </label>
        <label>
          可售库存（已排除预留）
          <input name="available" type="number" min="0" required />
        </label>
        <label>
          预留数量（仅展示）
          <input name="reserved" type="number" min="0" defaultValue="0" required />
        </label>
        <label>
          采购提前天数
          <input name="purchase" type="number" min="0" max="60" defaultValue="3" />
        </label>
        <label>
          运输天数
          <input name="transport" type="number" min="0" max="60" defaultValue="7" />
        </label>
        <label>
          入仓天数
          <input name="receiving" type="number" min="0" max="60" defaultValue="2" />
        </label>
        <label>
          安全库存天数
          <input name="safetyDays" type="number" min="0" max="30" defaultValue="7" />
        </label>
        <label>
          推演天数
          <input name="horizon" type="number" min="1" max="180" defaultValue="30" />
        </label>
        <label className="wide">
          在途（每行：到货日期,数量）
          <textarea name="inbound" placeholder="2026-11-01,100" />
        </label>
        <label className="wide">
          活动需求倍率（每行：日期,倍率）
          <textarea name="factors" placeholder="2026-11-05,1.5" />
        </label>
        <div className="form-actions wide">
          <button disabled={busy} className="primary">
            保存库存推演
          </button>
        </div>
      </form>
      {localError && (
        <p role="alert" className="error-message">
          {localError}
        </p>
      )}
      {!data.inventories.length && (
        <Empty
          icon="box"
          title="让补货有据可循"
          text="每个方案保留输入预测、可售口径、提前期与每日结果。"
        />
      )}
      {data.inventories.map((i) => (
        <section className="panel" key={i.id}>
          <h2>
            {i.store} · {i.listing}
          </h2>
          <p>
            {i.physicalSku} · 快照 {i.asOf} · 方案 {i.id.slice(0, 8)}
          </p>
          <div className="activity-stages">
            <div>
              <strong>首个缺货日</strong>
              <p>{i.projection.stockoutDate ?? '推演内未缺货'}</p>
            </div>
            <div>
              <strong>建议补货</strong>
              <p>{i.projection.replenishQuantity} 件</p>
              <small>提前期内缺口 {i.projection.urgentGap} 件，需核实加急/调拨</small>
            </div>
            <div>
              <strong>最晚准备 / 发货</strong>
              <p>
                {i.projection.lastPrepareDate ?? '—'} / {i.projection.lastShipDate ?? '—'}
              </p>
            </div>
          </div>
          {i.projection.assumptions.map((a) => (
            <p key={a}>
              <small>{a}</small>
            </p>
          ))}
          <p>
            预留 {i.reserved} 件，仅展示 · 预测损失需求 {i.projection.lostDemand} 件
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {['日期', '期初', '到货', '需求', '期末', '损失需求'].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {i.projection.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.opening}</td>
                    <td>{d.arrival}</td>
                    <td>{d.demand}</td>
                    <td>{d.closing}</td>
                    <td>{d.lostDemand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
