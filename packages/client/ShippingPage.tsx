import { useState, type FormEvent } from 'react';
import { type Snapshot, requestId, download } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import type { Shipment } from '../contracts/model.ts';
import { csvCell } from './csv.ts';
import { Badge, Empty } from './components.tsx';

const labels: Record<string, string> = {
  draft: '内部草稿',
  ready: '前置已齐',
  in_transit: '已人工登记发运',
  partially_received: '部分到货',
  received: '全部到货',
  cancelled: '已取消',
};
const prerequisiteNames = ['保修卡已申请', '标签已下载核对', '数据已认领', '店铺权限已取得'];
function ShipmentCard({ row, mutate, busy }: { row: Shipment; mutate: Mutate; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    await mutate('shipment-update', {
      id: row.id,
      revision: row.revision,
      requestId: requestId(),
      destination: v.get('destination'),
      owner: v.get('owner'),
      amazonId: v.get('amazonId'),
      erpId: v.get('erpId'),
      status: v.get('status'),
      received: Number(v.get('received')),
      prerequisites: prerequisiteNames.map((_, i) => v.get(`check${i}`) === 'on'),
    });
    setEdit(false);
  }
  function exportFields() {
    const columns = [
      'store',
      'site',
      'listing',
      'physicalSku',
      'quantity',
      'shipDate',
      'destination',
      'owner',
      'amazonId',
      'erpId',
    ];
    download(
      `发货资料-${row.shipDate}.csv`,
      [
        '店铺',
        '站点',
        '链接或商品编码',
        '实物商品编码',
        '数量',
        '发货日期',
        '目的仓',
        '负责人',
        '亚马逊单号',
        '公司系统单号',
      ]
        .map(csvCell)
        .join(',') +
        '\r\n' +
        columns.map((k) => csvCell(String(row[k as keyof Shipment] ?? ''))).join(','),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <section className="panel">
      <div className="page-heading">
        <div>
          <h2>
            {row.store} · {row.listing}
          </h2>
          <p>
            {row.physicalSku} · {row.quantity} 件 · 计划 {row.shipDate}
          </p>
        </div>
        <Badge>{labels[row.status]}</Badge>
      </div>
      <p>
        目的仓 {row.destination || '待填写'} · 负责人 {row.owner || '待填写'}
      </p>
      <p>
        亚马逊单号：{row.amazonId || '尚未关联'} · 公司系统单号：{row.erpId || '尚未关联'}
      </p>
      <p>
        累计到货 {row.received} / {row.quantity} 件
      </p>
      <div className="activity-stages">
        {prerequisiteNames.map((label, i) => (
          <div key={label}>
            {row.prerequisites[i] ? '✓' : '○'} {label}
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button onClick={exportFields}>导出共用建单字段</button>
        {!['received', 'cancelled'].includes(row.status) && (
          <button onClick={() => setEdit(!edit)}>更新检查与进度</button>
        )}
      </div>
      {edit && (
        <form className="form-grid" onSubmit={(e) => void submit(e).catch(() => {})}>
          <label>
            目的仓
            <input name="destination" defaultValue={row.destination} maxLength={200} />
          </label>
          <label>
            负责人
            <input name="owner" defaultValue={row.owner} maxLength={200} />
          </label>
          <label>
            亚马逊单号
            <input name="amazonId" defaultValue={row.amazonId} maxLength={200} />
          </label>
          <label>
            公司系统单号
            <input name="erpId" defaultValue={row.erpId} maxLength={200} />
          </label>
          <div className="wide">
            {prerequisiteNames.map((label, i) => (
              <label className="check-row" key={label}>
                <input type="checkbox" name={`check${i}`} defaultChecked={row.prerequisites[i]} />
                {label}
              </label>
            ))}
          </div>
          <label>
            记录状态
            <select name="status" defaultValue={row.status}>
              {Object.keys(labels).map((s) => (
                <option value={s} key={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            累计到货数量
            <input
              type="number"
              name="received"
              defaultValue={row.received}
              min={row.received}
              max={row.quantity}
            />
          </label>
          <p className="wide">
            请先在两系统核实真实结果再登记。这里不会建单或发运；运输中不可取消并返还库存。
          </p>
          <div className="form-actions wide">
            <button type="button" onClick={() => setEdit(false)}>
              返回
            </button>
            <button className="primary" disabled={busy}>
              确认更新内部记录
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
export function ShippingPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [poolId, setPool] = useState('');
  async function pool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    await mutate('pool', {
      requestId: requestId(),
      physicalSku: v.get('physicalSku'),
      batchReference: v.get('batchReference'),
      quantity: Number(v.get('quantity')),
      windows: String(v.get('windows'))
        .split('\n')
        .filter((s) => s.trim())
        .map((s) => {
          const [store, from, to] = s.split(',').map((x) => x.trim());
          return { store, from, to };
        }),
    });
  }
  async function allocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const row = data.pools.find((p) => p.id === poolId);
    await mutate('allocate', {
      requestId: requestId(),
      poolId,
      revision: row?.revision,
      inventoryId: v.get('inventoryId'),
      quantity: Number(v.get('quantity')),
      shipDate: v.get('shipDate'),
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">发货准备一起看</span>
          <h1>发货协同</h1>
          <p>共享库存只分配一次，共用字段只录入一次。外部操作由你完成。</p>
        </div>
        <Badge>内部草稿与人工关联</Badge>
      </div>
      <form className="panel form-grid" onSubmit={(e) => void pool(e).catch(() => {})}>
        <h2 className="wide">登记共享实物库存池</h2>
        <label>
          实物商品编码
          <input name="physicalSku" required maxLength={100} />
        </label>
        <label>
          物理批次编号
          <input
            name="batchReference"
            required
            maxLength={100}
            placeholder="同一批货各店共用此编号"
          />
        </label>
        <label>
          本批可分配数量
          <input name="quantity" type="number" min="0" required />
        </label>
        <label className="wide">
          店铺可用时间窗（每行：店铺,起始日期,结束日期）
          <textarea name="windows" required placeholder="示例店铺,2026-10-26,2026-11-30" />
        </label>
        <p className="wide">同一物理批次只建一个池。已发出份额不会自动返还；新入库需登记新批次。</p>
        <div className="form-actions wide">
          <button className="primary" disabled={busy}>
            保存库存池
          </button>
        </div>
      </form>
      {data.pools.map((p) => (
        <section className="panel" key={p.id}>
          <h3>{p.physicalSku} · 共享池</h3>
          <p>
            总量 {p.quantity} · 已占用{' '}
            {data.allocations
              .filter((a) => a.poolId === p.id && a.status !== 'released')
              .reduce((s, a) => s + a.quantity, 0)}
          </p>
          {p.windows.map((w, i) => (
            <p key={i}>
              {w.store}：{w.from} → {w.to}
            </p>
          ))}
        </section>
      ))}
      <form className="panel form-grid" onSubmit={(e) => void allocation(e).catch(() => {})}>
        <h2 className="wide">确认分配与发货去向</h2>
        <label>
          共享池
          <select value={poolId} onChange={(e) => setPool(e.target.value)} required>
            <option value="">请选择</option>
            {data.pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.physicalSku} · {p.batchReference || '未填写批次'}
              </option>
            ))}
          </select>
        </label>
        <label>
          库存方案 / 店铺
          <select name="inventoryId" required>
            <option value="">请选择</option>
            {data.inventories.map((i) => (
              <option key={i.id} value={i.id}>
                {i.store} / {i.listing} / {i.physicalSku} / {i.asOf}
              </option>
            ))}
          </select>
        </label>
        <label>
          分配件数
          <input name="quantity" type="number" min="1" required />
        </label>
        <label>
          计划发货日期
          <input name="shipDate" type="date" required />
        </label>
        <div className="form-actions wide">
          <button className="primary" disabled={busy}>
            确认内部预留
          </button>
        </div>
      </form>
      {data.allocations
        .filter(
          (a) => a.status === 'reserved' && !data.shipments.some((s) => s.allocationId === a.id),
        )
        .map((a) => (
          <section className="panel" key={a.id}>
            <h3>
              {a.store} · {a.listing} · {a.quantity} 件
            </h3>
            <p>
              {a.physicalSku} · {a.shipDate}
            </p>
            <button
              disabled={busy}
              className="primary"
              onClick={() => void mutate('shipment', { allocationId: a.id }).catch(() => {})}
            >
              生成共用发货草稿
            </button>
          </section>
        ))}
      {!data.shipments.length && (
        <Empty
          icon="box"
          title="让发货的每一步都清楚"
          text="确认分配后生成草稿，逐项检查前置、关联双单号，再记录发运与到货。"
        />
      )}
      {data.shipments.map((row) => (
        <ShipmentCard key={`${row.id}:${row.revision}`} row={row} mutate={mutate} busy={busy} />
      ))}
    </>
  );
}
