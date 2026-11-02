import { useState, type FormEvent } from 'react';
import type { Snapshot } from './api.ts';
import { requestId, download } from './api.ts';
import { Badge, Empty, Icon, SourceList, states } from './components.tsx';
import type { Mutate } from './TasksPage.tsx';

export function KnowledgePage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [tab, setTab] = useState('skills');
  const [showForm, setShowForm] = useState(false);
  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate('memory', {
      key: form.get('key'),
      value: form.get('value'),
      requestId: requestId(),
    });
    setShowForm(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">让下次更省力</span>
          <h1>经验与记忆</h1>
          <p>记住经过确认的事，让成功流程下次更省力。</p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void mutate('learning', { enabled: !data.learningEnabled }).catch(() => {})
          }
          disabled={busy}
        >
          {data.learningEnabled ? '暂停自动学习' : '恢复自动学习'}
        </button>
      </div>
      <div className="learning-banner">
        <span className="round-icon">
          <Icon name="book" size={22} />
        </span>
        <div>
          <strong>{data.learningEnabled ? '正在积累，而不是盲目照搬' : '自动学习已暂停'}</strong>
          <p>清单需逐项检查并确认成功，才会变成可复用经验。你随时可以停用或删除。</p>
        </div>
        <Badge tone={data.learningEnabled ? 'green' : ''}>
          {data.learningEnabled ? '学习开启' : '已暂停'}
        </Badge>
      </div>
      <div className="tabs">
        <button className={tab === 'skills' ? 'selected' : ''} onClick={() => setTab('skills')}>
          流程经验 <span>{data.skills.length}</span>
        </button>
        <button className={tab === 'memory' ? 'selected' : ''} onClick={() => setTab('memory')}>
          业务记忆 <span>{data.memories.length}</span>
        </button>
      </div>
      {tab === 'skills' ? (
        !data.skills.length ? (
          <section className="panel">
            <Empty
              title="第一条经验，来自一次成功"
              text="完成任务、确认流程成功后，工作台会整理成下次可用的经验。"
              icon="book"
            />
          </section>
        ) : (
          <div className="card-list">
            {data.skills.map((skill) => (
              <article className="panel" key={skill.id}>
                <div className="card-heading">
                  <h2>{skill.description}</h2>
                  <Badge tone={skill.status === 'active' ? 'green' : ''}>
                    {states[skill.status]}
                  </Badge>
                </div>
                <p className="metadata">适用于当前工作范围</p>
                <ol className="skill-steps">
                  {skill.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
                {skill.validation.length > 0 && (
                  <p className="notice">这条经验还需核对，暂时无法启用。请联系工作台维护者。</p>
                )}
                <div className="card-footer">
                  <SourceList sources={skill.sources} />
                  <div>
                    {skill.status === 'waiting_confirmation' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate('skill-confirm', {
                            id: skill.id,
                            revision: skill.revision,
                          }).catch(() => {})
                        }
                      >
                        确认使用这条经验
                      </button>
                    )}
                    {skill.status === 'active' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate('skill-revoke', { id: skill.id }).catch(() => {})
                        }
                      >
                        停用经验
                      </button>
                    )}
                    <button
                      className="text-button muted-text"
                      disabled={busy}
                      onClick={() => void mutate('delete', { id: skill.id }).catch(() => {})}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="section-heading">
            <h2>已确认与待确认的事实</h2>
            <button className="text-button" onClick={() => setShowForm(!showForm)}>
              <Icon name="plus" size={16} /> 记住一件事
            </button>
          </div>
          {showForm && (
            <form
              className="panel form-grid"
              onSubmit={(event) => void addMemory(event).catch(() => {})}
            >
              <label>
                记忆名称
                <input name="key" required maxLength={80} placeholder="活动准备提前量" />
              </label>
              <label>
                确认后的内容
                <input
                  name="value"
                  required
                  maxLength={300}
                  placeholder="6 小时，仅适用于美站当前流程"
                />
              </label>
              <div className="wide form-actions">
                <span>同名新记忆会保留旧版的更正关系。</span>
                <button className="primary" disabled={busy || !data.learningEnabled}>
                  确认并记住
                </button>
              </div>
            </form>
          )}
          {data.summary && (
            <div className="memory-summary">
              <span className="eyebrow">记忆小结</span>
              <p>{data.summary.summary || '暂无有效的已确认记忆'}</p>
              <small>这里只是简要整理，具体内容请看下方记忆。</small>
            </div>
          )}
          {!data.memories.length ? (
            <section className="panel">
              <Empty
                title="还没有业务记忆"
                text="例如：告诉助手“记住：活动准备提前量是 6 小时”。"
                icon="book"
              />
            </section>
          ) : (
            <div className="card-list">
              {data.memories.map((memory) => (
                <article
                  className={`panel ${memory.status === 'superseded' ? 'faded' : ''}`}
                  key={memory.id}
                >
                  <div className="card-heading">
                    <h2>{memory.key}</h2>
                    <Badge>{states[memory.status]}</Badge>
                  </div>
                  <p>{memory.value}</p>
                  <div className="card-footer">
                    <SourceList sources={memory.sources} />
                    <button
                      className="text-button muted-text"
                      disabled={busy}
                      onClick={() => void mutate('delete', { id: memory.id }).catch(() => {})}
                    >
                      删除这条记忆
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
