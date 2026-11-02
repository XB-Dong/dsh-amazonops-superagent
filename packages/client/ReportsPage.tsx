import { useEffect, useRef, useState } from 'react';
import type { ReportInput } from '../contracts/model.ts';
import type { Snapshot } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import { Badge, Empty } from './components.tsx';
import { reportLabels, siteLabel } from './display.ts';
import { SitePicker } from './SitePicker.tsx';
import { download } from './api.ts';
import { csvCell } from './csv.ts';

const columns = {
  sales: ['date', 'listing', 'units'],
  ads: [
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
  ],
};
export function ReportsPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [kind, setKind] = useState<'sales' | 'ads'>('sales');
  const [csv, setCSV] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>(
    Object.fromEntries(columns.sales.map((key) => [key, reportLabels[key]])),
  );
  const [store, setStore] = useState('');
  const [site, setSite] = useState('US');
  const [asOf, setAsOf] = useState('');
  const [preview, setPreview] = useState<{
    rows: Record<string, string | number>[];
    warnings: string[];
  }>();
  const [pending, setPending] = useState<ReportInput>();
  const [localError, setLocalError] = useState('');
  const latestInput = useRef('');
  latestInput.current = JSON.stringify({ kind, csv, mapping, store, site, asOf });
  useEffect(() => {
    setPreview(undefined);
    setPending(undefined);
  }, [kind, csv, mapping, store, site, asOf]);
  async function inspect() {
    setLocalError('');
    const signature = latestInput.current;
    try {
      const input = {
        kind,
        csv,
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, value]) => value.trim())),
        store,
        site,
        asOf,
      };
      const result = await mutate('report-preview', input);
      if (latestInput.current !== signature) return;
      setPreview(result as typeof preview);
      setPending(input);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '预览失败');
      setPreview(undefined);
      setPending(undefined);
    }
  }
  function sample() {
    const fields = columns[kind];
    setStore('示例店铺');
    setAsOf('2026-10-25');
    setCSV(
      kind === 'sales'
        ? '日期,商品编码,销量\n2026-10-25,示例商品,5'
        : '日期,商品编码,广告活动,搜索词,展示次数,点击次数,广告花费,订单数,销售额,币种\n2026-10-25,示例商品,示例广告,示例词,1000,20,15,2,60,USD',
    );
    setMapping(Object.fromEntries(fields.map((key) => [key, reportLabels[key]])));
    setPreview(undefined);
    setPending(undefined);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">先核对，再使用</span>
          <h1>数据报表</h1>
          <p>先用示例练习。公司资料确认允许上传后，再导入实际报表。</p>
        </div>
        <button onClick={sample} disabled={busy}>
          填入示例
        </button>
      </div>
      <fieldset className="panel form-grid" disabled={busy}>
        <label>
          报表类型
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'sales' | 'ads');
              setMapping(
                Object.fromEntries(
                  columns[e.target.value as 'sales' | 'ads'].map((key) => [key, reportLabels[key]]),
                ),
              );
              setPreview(undefined);
              setPending(undefined);
            }}
          >
            <option value="sales">日销量</option>
            <option value="ads">广告明细</option>
          </select>
        </label>
        <label>
          店铺
          <input value={store} onChange={(e) => setStore(e.target.value)} maxLength={100} />
        </label>
        <SitePicker value={site} onChange={setSite} />
        <label>
          数据截至日期
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="wide">
          选择报表文件（.csv）
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 100000) {
                setLocalError('文件超过100KB');
                return;
              }
              void f
                .text()
                .then((text) => {
                  setCSV(text);
                  setPreview(undefined);
                  setPending(undefined);
                })
                .catch(() => setLocalError('文件没有读取成功，请重新选择。'));
            }}
          />
        </label>
        <label className="wide">
          报表内容（也可以直接粘贴）
          <textarea
            rows={7}
            value={csv}
            onChange={(e) => {
              setCSV(e.target.value);
              setPreview(undefined);
              setPending(undefined);
            }}
            placeholder="可以先点击上方“填入示例”，熟悉报表格式。"
          />
        </label>
        <div className="wide">
          <h3>核对报表列名</h3>
          <p>填写你的报表第一行中，对应每项内容的列名。示例已经填好；“广告组”没有时可留空。</p>
          <div className="form-grid">
            {[...columns[kind], ...(kind === 'ads' ? ['adGroup'] : [])].map((key) => (
              <label key={key}>
                {reportLabels[key]}
                {key === 'adGroup' ? '（可选）' : ''}
                <input
                  value={mapping[key] ?? ''}
                  placeholder={reportLabels[key]}
                  onChange={(e) => setMapping((old) => ({ ...old, [key]: e.target.value }))}
                  maxLength={200}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="form-actions wide">
          <button disabled={busy} className="primary" onClick={() => void inspect()}>
            检查并预览
          </button>
        </div>
      </fieldset>
      {localError && (
        <p role="alert" className="error-message">
          {localError}
        </p>
      )}
      {preview && pending && (
        <section className="panel">
          <h2>预览 · {preview.rows.length} 行</h2>
          <p>
            {pending.store} / {siteLabel(pending.site)} / 截至 {pending.asOf}
          </p>
          {preview.warnings.map((w) => (
            <p key={w}>{w.replace('仅使用已确认规范列', '只使用你已核对的报表列')}</p>
          ))}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(preview.rows[0]).map((k) => (
                    <th key={k}>{reportLabels[k] ?? k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {Object.values(r).map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void mutate('report-import', pending)
                .then(() => {
                  setPreview(undefined);
                  setPending(undefined);
                })
                .catch(() => {})
            }
          >
            确认导入这份预览
          </button>
        </section>
      )}
      {!data.reports.length && (
        <section className="panel">
          <Empty
            icon="chart"
            title="每个结论都从数据开始"
            text="导入后的批次、日期和来源会保留；缺失日期不会视为零销量。"
          />
        </section>
      )}
      {data.reports.map((r, index) => (
        <section className="panel" key={r.id}>
          <Badge>{r.reportKind === 'sales' ? '销量' : '广告'}</Badge>
          <h3>
            {r.store} · {siteLabel(r.site)}
          </h3>
          <p>
            截至 {r.asOf} · {r.rows.length} 行 · 第{index + 1}份报表
          </p>
          <button onClick={()=>{
            const fields=Object.keys(r.rows[0]??{});
            const content=[fields.map(key=>csvCell(reportLabels[key]??key)).join(','),
              ...r.rows.map(row=>fields.map(key=>csvCell(row[key])).join(','))].join('\r\n');
            download(`report-${r.reportKind}-${r.asOf}-${r.id}.csv`,content,'text/csv;charset=utf-8');
          }}>导出本批CSV</button>
        </section>
      ))}
    </>
  );
}
