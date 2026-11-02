import { useWorkbench } from './controller.ts';
import { api, empty, modelLabel, assistantHealthy, type Snapshot, type Status } from './api.ts';
import { Icon } from './components.tsx';
import { Overview } from './Overview.tsx';
import { TasksPage } from './TasksPage.tsx';
import { FeedbackPage } from './FeedbackPage.tsx';
import { KnowledgePage } from './KnowledgePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { Assistant } from './Assistant.tsx';
import { ActivitiesPage } from './ActivitiesPage.tsx';
import { ReportsPage } from './ReportsPage.tsx';
import { InventoryPage } from './InventoryPage.tsx';
import { ShippingPage } from './ShippingPage.tsx';
import { AdvertisingPage } from './AdvertisingPage.tsx';
import { HelpPage } from './HelpPage.tsx';
import { NotesPage } from './NotesPage.tsx';
import { WorkCalendarPage } from './WorkCalendarPage.tsx';

const navigation = [
  { id: 'home', name: '工作台', icon: 'home' },
  { id: 'assistant', name: '运营助手', icon: 'chat' },
  { id: 'tasks', name: '任务清单', icon: 'tasks' },
  { id: 'work-calendar', name: '工作日历', icon: 'calendar' },
  { id: 'notes', name: '学习笔记', icon: 'book' },
  { id: 'feedback', name: '改进反馈', icon: 'feedback' },
  { id: 'knowledge', name: '经验与记忆', icon: 'book' },
  { id: 'activities', name: '活动日历', icon: 'calendar' },
  { id: 'reports', name: '数据报表', icon: 'chart' },
  { id: 'inventory', name: '库存补货', icon: 'box' },
  { id: 'shipping', name: '发货协同', icon: 'box' },
  { id: 'advertising', name: '广告分析', icon: 'chart' },
  { id: 'help', name: '使用说明', icon: 'book' },
];
export function App({ openSession }: { openSession?: (id: string) => void }) {
  const {page,status,data,ready,authenticated,error,notice,busy,initialPrompt,menuOpen,setMenuOpen,setError,setAuthenticated,setData,refresh,login,mutate,navigate,prompt} = useWorkbench();
  if (!ready)
    return (
      <div className="initial-loading">
        <div className="brand-mark">
          c<span>c</span>
        </div>
        <p>正在打开你的工作台…</p>
      </div>
    );
  if (!authenticated) return <LoginPage busy={busy} error={error} login={login} />;
  const name =
    [...navigation, { id: 'settings', name: '设置' }].find((item) => item.id === page)?.name ??
    '工作台';
  return (
    <div className="app-shell">
      <button
        className={`mobile-backdrop ${menuOpen ? 'visible' : ''}`}
        aria-label="关闭菜单"
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('home')}>
          <div className="brand-mark">
            c<span>c</span>
          </div>
          <div>
            <strong>cc 的工作台</strong>
            <small>你的专属运营助手</small>
          </div>
        </button>
        <nav aria-label="主要导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {item.id === 'tasks' &&
                data.tasks.filter((row) => ['open', 'in_progress', 'draft'].includes(row.status))
                  .length > 0 && (
                  <small>
                    {
                      data.tasks.filter((row) =>
                        ['open', 'in_progress', 'draft'].includes(row.status),
                      ).length
                    }
                  </small>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="learning-mini">
            <span className={`status-dot ${data.learningEnabled ? '' : 'muted'}`} />
            <span>{data.learningEnabled ? '在你的确认中，慢慢学习' : '自动学习已暂停'}</span>
          </div>
          <button
            className={`settings-link ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Icon name="settings" />
            <span>工作台设置</span>
          </button>
          <div className="profile">
            <div>cc</div>
            <p>
              <strong>cc</strong>
              <span>专属运营空间</span>
            </p>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <button className="mobile-menu" aria-label="打开菜单" onClick={() => setMenuOpen(true)}>
              ☰
            </button>
            <span className="breadcrumb">
              我的空间 <span>/</span> <strong>{name}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span className={`status-dot ${assistantHealthy(status) ? '' : 'muted'}`} />
              {modelLabel(status)}
            </span>
            <span className="private-label">专属工作台</span>
            <div className="avatar-small">cc</div>
          </div>
        </header>
        <main className={`main-content ${page === 'assistant' ? 'chat-main' : ''}`}>
          {error && (
            <div className="error-message global-error" role="alert">
              {error}
              <button aria-label="关闭提示" onClick={() => setError('')}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {page === 'home' && (
            <Overview data={data} status={status} navigate={navigate} prompt={prompt} />
          )}{' '}
          {page === 'assistant' && (
            <Assistant
              data={data}
              status={status}
              initialPrompt={initialPrompt}
              refresh={refresh}
              reportError={setError}
              openSession={openSession}
            />
          )}{' '}
          {page === 'tasks' && <TasksPage data={data} mutate={mutate} busy={busy} />}{' '}
          {page === 'work-calendar' && <WorkCalendarPage data={data} mutate={mutate} busy={busy} />}
          {page === 'notes' && <NotesPage data={data} mutate={mutate} busy={busy} />}
          {page === 'feedback' && <FeedbackPage data={data} mutate={mutate} busy={busy} />}{' '}
          {page === 'knowledge' && <KnowledgePage data={data} mutate={mutate} busy={busy} />}
          {page === 'activities' && <ActivitiesPage data={data} mutate={mutate} busy={busy} />}
          {page === 'reports' && <ReportsPage data={data} mutate={mutate} busy={busy} />}
          {page === 'inventory' && <InventoryPage data={data} mutate={mutate} busy={busy} />}
          {page === 'shipping' && <ShippingPage data={data} mutate={mutate} busy={busy} />}
          {page === 'advertising' && <AdvertisingPage data={data} mutate={mutate} busy={busy} />}
          {page === 'help' && <HelpPage />}
          {page === 'settings' && (
            <SettingsPage
              data={data}
              status={status}
              busy={busy}
              mutate={mutate}
              logout={() =>
                void api('logout', {}).then(() => {
                  setAuthenticated(false);
                  setData(empty);
                })
              }
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>cc 的运营工作台</span>
          <span>让工作有序，让经验留下。</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
