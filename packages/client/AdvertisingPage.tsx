import { type FormEvent } from 'react';
import { type Snapshot, download } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import type { AdOptions, AdAnalysis } from '../contracts/model.ts';
import { csvCell } from './csv.ts';
import { Badge, Empty } from './components.tsx';
import { siteLabel } from './display.ts';
const display = (value: number | null, percent = false) =>
  value === null ? '—' : value.toFixed(2) + (percent ? '%' : '');
function exportAnalysis(a: AdAnalysis) {
  const columns = [
    'name',
    'currency',
    'impressions',
    'clicks',
    'spend',
    'orders',
    'revenue',
    'ctr',
    'cpc',
    'cvr',
    'acos',
    'roas',
    'profit',
  ];
  download(
    `广告分析-${a.asOf}.csv`,
    [
      '分析对象',
      '币种',
      '展示次数',
      '点击次数',
      '广告花费',
      '订单数',
      '销售额',
      '点击率',
      '每次点击花费',
      '下单转化率',
      '广告花费占比',
      '每元广告带来销售额',
      '估计利润',
    ]
      .map(csvCell)
      .join(',') +
      '\r\n' +
      a.groups
        .map((g) => columns.map((k) => csvCell(String(g[k as keyof typeof g] ?? '未知'))).join(','))
        .join('\r\n'),
    'text/csv;charset=utf-8',
  );
}
export function AdvertisingPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const options: AdOptions = {
      groupBy: String(v.get('groupBy')) as AdOptions['groupBy'],
      attributionDays: Number(v.get('attributionDays')),
      minClicks: Number(v.get('minClicks')),
      maxACOS: Number(v.get('maxACOS')),
      campaignFilter: String(v.get('campaignFilter')).trim() || undefined,
      dailyBudget: v.get('dailyBudget') === '' ? undefined : Number(v.get('dailyBudget')),
      budgetCurrency: String(v.get('budgetCurrency')).trim() || undefined,
      costPerOrder: v.get('costPerOrder') === '' ? undefined : Number(v.get('costPerOrder')),
      costCurrency: String(v.get('costCurrency')).trim() || undefined,
      costBasisComplete: v.get('complete') === 'on',
    };
    await mutate('advertising', { batchId: v.get('batchId'), options });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">看清数据，再做判断</span>
          <h1>广告分析</h1>
          <p>按报表计算，看清归因、数据日期与利润假设，再由你决定。</p>
        </div>
        <Badge>只读建议</Badge>
      </div>
      <form className="panel form-grid" onSubmit={(e) => void submit(e).catch(() => {})}>
        <label className="wide">
          广告报表批次
          <select name="batchId" required>
            <option value="">请选择</option>
            {data.reports
              .filter((r) => r.reportKind === 'ads')
              .map((r) => (
                <option value={r.id} key={r.id}>
                  {r.store} · {siteLabel(r.site)} · 截至{r.asOf} · 第{data.reports.indexOf(r) + 1}
                  份报表
                </option>
              ))}
          </select>
        </label>
        <label>
          分析维度
          <select name="groupBy">
            <option value="listing">链接或商品编码</option>
            <option value="campaign">广告活动</option>
            <option value="adGroup">广告组（报表需包含广告组）</option>
            <option value="searchTerm">搜索词</option>
          </select>
        </label>
        <label>
          报表归因窗口（天）
          <input name="attributionDays" type="number" min="1" max="90" defaultValue="7" required />
          <small>请按报表实际口径填写，不推定平台统一窗口</small>
        </label>
        <label>
          判断所需点击数
          <input name="minClicks" type="number" min="0" max="100000" defaultValue="20" required />
        </label>
        <label>
          目标广告花费占销售额（%）
          <input
            name="maxACOS"
            type="number"
            min="0"
            max="1000"
            defaultValue="30"
            step="0.1"
            required
          />
        </label>
        <label>
          仅分析广告活动（可选）
          <input name="campaignFilter" maxLength={200} />
        </label>
        <label>
          该活动每日预算（可选）
          <input name="dailyBudget" type="number" min="0" step="0.01" />
          <small>需按广告活动分组并指定活动；只用于检查录入目标</small>
        </label>
        <label>
          预算币种
          <input name="budgetCurrency" placeholder="USD" maxLength={3} />
        </label>
        <label>
          每订单非广告总成本（可选）
          <input name="costPerOrder" type="number" min="0" step="0.01" />
        </label>
        <label>
          成本币种
          <input name="costCurrency" placeholder="USD" maxLength={3} />
        </label>
        <label className="wide check-row">
          <input name="complete" type="checkbox" />
          已核对每订单成本完整，包括商品、运费、平台费用等需计入项
        </label>
        <p className="wide">
          成本不完整或币种不一致时，利润显示未知。输入成本只用于估计，不代表财务结算。
        </p>
        <div className="form-actions wide">
          <button disabled={busy} className="primary">
            查看分析建议
          </button>
        </div>
      </form>
      {!data.adAnalyses.length && (
        <Empty
          icon="chart"
          title="先看清数据，再决定动作"
          text="先到“数据报表”导入广告示例。这里提供建议，调整仍由你操作。"
        />
      )}
      {data.adAnalyses.map((a) => (
        <section className="panel" key={a.id}>
          <div className="page-heading">
            <div>
              <h2>
                {a.store} · {siteLabel(a.site)}
              </h2>
              <p>
                截至 {a.asOf} · 归因 {a.options.attributionDays} 天
              </p>
            </div>
            <button onClick={() => exportAnalysis(a)}>导出指标</button>
          </div>
          <p>
            目标广告花费占比 {a.options.maxACOS}% · 最低点击 {a.options.minClicks} · 分类{' '}
            {
              { listing: '链接', campaign: '广告活动', adGroup: '广告组', searchTerm: '搜索词' }[
                a.options.groupBy
              ]
            }
          </p>
          {!a.groups.length && <p>所选活动在这份批次中没有记录，请核对筛选条件。</p>}
          {a.groups.map((g, i) => (
            <div className="ad-group" key={i}>
              <h3>
                {g.campaign ? `${g.campaign} / ` : ''}
                {g.name} · {g.currency}
              </h3>
              <p>
                最新数据 {g.latestDate} · {g.mature ? '归因窗口已覆盖' : '归因待观察'}
              </p>
              <div className="activity-stages">
                <div>
                  花费
                  <strong>
                    {display(g.spend)} {g.currency}
                  </strong>
                </div>
                <div>
                  归因收入
                  <strong>
                    {display(g.revenue)} {g.currency}
                  </strong>
                </div>
                <div>
                  广告花费占比<strong>{display(g.acos, true)}</strong>
                </div>
                <div>
                  每元广告带来销售额<strong>{display(g.roas)}</strong>
                </div>
              </div>
              <p>
                展示 {g.impressions} · 点击 {g.clicks} · 订单 {g.orders} · 点击率{' '}
                {display(g.ctr, true)} · 每次点击花费 {display(g.cpc)} · 下单转化率{' '}
                {display(g.cvr, true)}
              </p>
              <p>
                估计利润：
                {g.profit === null
                  ? '未知：缺少完整同币种成本'
                  : `${display(g.profit)} ${g.currency}`}
              </p>
              <ul>
                {g.suggestions.map((s) => (
                  <li key={s}>{s.replaceAll('ACOS', '广告花费占比')}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
