import { modelLabel, assistantHealthy, type Snapshot, type Status } from './api.ts';
import { Badge } from './components.tsx';
import type { Mutate } from './TasksPage.tsx';

export function SettingsPage({
  data,
  status,
  busy,
  mutate,
  logout,
}: {
  data: Snapshot;
  status?: Status;
  busy: boolean;
  mutate: Mutate;
  logout: () => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">按你的习惯使用</span>
          <h1>工作台设置</h1>
          <p>管理助手学习，或退出当前账号。</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <div>
          <span>运营助手</span>
          <Badge tone={assistantHealthy(status) ? 'green' : ''}>{modelLabel(status)}</Badge>
        </div>
        <div>
          <span>自动学习</span>
          <button
            className="secondary small"
            disabled={busy}
            onClick={() =>
              void mutate('learning', { enabled: !data.learningEnabled }).catch(() => {})
            }
          >
            {data.learningEnabled ? '暂停' : '恢复'}
          </button>
        </div>
        <div>
          <span>需求与经验</span>
          <p>已保存的反馈和经验可在左侧对应页面查看。</p>
        </div>
        <div>
          <span>离开工作台</span>
          <button className="text-button" onClick={logout}>
            退出登录
          </button>
        </div>
      </section>
    </>
  );
}
