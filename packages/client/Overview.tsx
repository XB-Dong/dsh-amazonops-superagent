import { modelLabel, assistantHealthy, type Snapshot, type Status } from './api.ts';
import { timeZoneLabel } from './display.ts';
import { Badge, Empty, Icon, states } from './components.tsx';

export function Overview({
  data,
  status,
  navigate,
  prompt,
}: {
  data: Snapshot;
  status?: Status;
  navigate: (page: string) => void;
  prompt: (text: string) => void;
}) {
  const tasks = data.tasks.filter((row) => !['done', 'cancelled'].includes(row.status));
  const stats = [
    {
      name: '待办任务',
      value: tasks.length,
      icon: 'tasks',
      detail: '把事情一件件推进',
      page: 'tasks',
    },
    {
      name: '改进反馈',
      value: data.feedback.filter((row) => row.status !== 'withdrawn').length,
      icon: 'feedback',
      detail: '你的建议都会留下',
      page: 'feedback',
    },
    {
      name: '可复用经验',
      value: data.skills.filter((row) => row.status === 'active').length,
      icon: 'book',
      detail: '从成功流程中积累',
      page: 'knowledge',
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">从这里开始今天的工作</span>
          <h1>今天，也从容一点。</h1>
          <p>把重复的事交给工作台，把精力留给判断。</p>
        </div>
        <span className="date-label">
          {new Intl.DateTimeFormat('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(new Date())}
        </span>
      </div>
      <section className="welcome-card">
        <div className="welcome-content">
          <div className="assistant-mark">
            <Icon name="spark" size={24} />
          </div>
          <h2>cc，你好！</h2>
          <p>
            今天想先处理哪件事？我可以帮你整理任务、记下改进建议，
            <br className="desktop-break" />
            也会慢慢记住你确认过的习惯和成功经验。
          </p>
          <button className="primary" onClick={() => navigate('assistant')}>
            开始和助手聊聊 <Icon name="arrow" size={17} />
          </button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-note">
            <span className="art-dot" />
            <span>把复杂，变成有序</span>
            <i />
            <i />
            <div>
              <span />
              <span />
            </div>
          </div>
          <div className="art-seal">
            <Icon name="check" size={26} />
          </div>
        </div>
      </section>
      {data.reminders.some((r) => !r.read) && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">别忘了这些事</span>
              <h2>有活动事项到期了</h2>
            </div>
            <button onClick={() => navigate('activities')}>
              查看到期提醒（{data.reminders.filter((r) => !r.read).length}）
            </button>
          </div>
          {data.reminders
            .filter((r) => !r.read)
            .slice(0, 3)
            .map((r) => (
              <p key={r.id}>
                {r.title} · {new Date(r.dueAt).toLocaleString('zh-CN', { timeZone: r.timeZone })} ·{' '}
                {timeZoneLabel(r.timeZone)}
              </p>
            ))}
        </section>
      )}
      <div className="stats-grid">
        {stats.map((item) => (
          <button className="stat-card" key={item.name} onClick={() => navigate(item.page)}>
            <div className="stat-top">
              <span>{item.name}</span>
              <span className={`stat-icon ${item.icon}`}>
                <Icon name={item.icon} />
              </span>
            </div>
            <strong>
              {item.value}
              <small>项</small>
            </strong>
            <p>
              {item.detail}
              <Icon name="arrow" size={15} />
            </p>
          </button>
        ))}
      </div>
      <div className="overview-columns">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">一件一件来</span>
              <h2>接下来做什么</h2>
            </div>
            <button className="text-button" onClick={() => navigate('tasks')}>
              全部任务 <Icon name="arrow" size={16} />
            </button>
          </div>
          {tasks.length ? (
            <div className="focus-list">
              {tasks.slice(0, 5).map((task) => (
                <button key={task.id} onClick={() => navigate('tasks')}>
                  <span className="task-circle" />
                  <div>
                    <strong>{task.title}</strong>
                    <p>
                      {timeZoneLabel(task.timeZone)}{' '}
                      {task.dueAt
                        ? ` · ${new Intl.DateTimeFormat('zh-CN', { timeZone: task.timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(task.dueAt))}`
                        : ' · 未设时间'}
                    </p>
                  </div>
                  <Badge>{states[task.status]}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon="tasks"
              title="待办清单还是空的"
              text="记下第一件事，工作台会帮你持续跟进。"
            />
          )}
          <button className="add-row" onClick={() => navigate('tasks')}>
            <Icon name="plus" size={18} /> 创建一个任务
          </button>
        </section>
        <aside className="panel inspiration">
          <span className="eyebrow">不知道怎么开口？</span>
          <h2>试着对我说</h2>
          {[
            '帮我整理明天活动前的准备清单',
            '这个页面不好用，帮我记下来',
            '记住：活动准备提前量是 6 小时',
          ].map((text, index) => (
            <button key={text} onClick={() => prompt(text)}>
              <span>0{index + 1}</span>
              <p>{text}</p>
              <Icon name="arrow" size={16} />
            </button>
          ))}
          <div className="quiet-note">
            <span className={`status-dot ${assistantHealthy(status) ? '' : 'muted'}`} />
            {modelLabel(status)} · 基础记录随时可用
          </div>
        </aside>
      </div>
      <div className="bottom-note">
        <Icon name="spark" size={16} />
        <span>每一次反馈，让这里更懂你的工作方式。</span>
        <button onClick={() => navigate('feedback')}>留一条建议</button>
      </div>
    </>
  );
}
