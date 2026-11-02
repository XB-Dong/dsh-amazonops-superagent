import { useState, type FormEvent } from 'react';
import type { Snapshot } from './api.ts';
import { requestId, download } from './api.ts';
import { Badge, Empty, Icon, SourceList, states } from './components.tsx';
import type { Mutate } from './TasksPage.tsx';

export function FeedbackPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot;
  mutate: Mutate;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate('feedback', { text, requestId: requestId(), page: 'feedback' });
    setText('');
  }
  async function exportPack() {
    const pack = (await mutate('export', {})) as { markdown: string; date: string };
    download(`工作台改进建议-${pack.date}.md`, pack.markdown);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">你的建议会被记住</span>
          <h1>改进反馈</h1>
          <p>不顺手的地方，值得被认真记下来。</p>
        </div>
        <button
          className="secondary"
          onClick={() => void exportPack().catch(() => {})}
          disabled={busy}
        >
          下载已确认建议
        </button>
      </div>
      <form
        className="panel feedback-form"
        onSubmit={(event) => void submit(event).catch(() => {})}
      >
        <label htmlFor="feedback-text">哪里可以做得更好？</label>
        <textarea
          id="feedback-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          required
          maxLength={12000}
          placeholder="比如：库存页面希望能按预计缺货时间排序……"
        />
        <div className="form-actions">
          <span>写下你的想法；确认后的建议可按日期下载。</span>
          <button className="primary" disabled={busy || !data.learningEnabled}>
            记下这条建议 <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
      {!data.learningEnabled && <div className="notice">学习已暂停，开启后可继续沉淀新反馈。</div>}
      <div className="section-heading">
        <h2>
          已记录的声音 <small>{data.feedback.length}</small>
        </h2>
        <span className="metadata">先记下建议，确认后再安排改进</span>
      </div>
      {!data.feedback.length ? (
        <section className="panel">
          <Empty
            title="还没有改进反馈"
            text="在这里写一句，或在对话中直接告诉助手哪里不好用。"
            icon="feedback"
          />
        </section>
      ) : (
        <div className="card-list">
          {data.feedback.map((row) => (
            <article className="panel" key={row.id}>
              <div className="card-heading">
                <Badge>{states[row.status] ?? row.status}</Badge>
                <span className="metadata">
                  {new Date(row.createdAt).toLocaleDateString('zh-CN')} · {row.count} 次记录
                </span>
              </div>
              <p className="feedback-body">{row.text}</p>
              {row.expected && <p className="metadata">期望：{row.expected}</p>}
              {row.actual && <p className="metadata">实际：{row.actual}</p>}
              {(row.amendments ?? []).map((item) => (
                <p className="feedback-body" key={item.sourceId}>
                  补充：{item.text}
                </p>
              ))}
              {row.status !== 'withdrawn' && (
                <details className="feedback-amendment">
                  <summary>补充或纠正这条建议</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const values = new FormData(form);
                      void mutate('feedback-append', {
                        id: row.id,
                        revision: row.revision,
                        text: values.get('text'),
                        requestId: requestId(),
                      })
                        .then(() => form.reset())
                        .catch(() => {});
                    }}
                  >
                    <input
                      name="text"
                      aria-label="补充内容"
                      required
                      maxLength={1000}
                      placeholder="补充预期、实际表现或更正说明"
                    />
                    <button className="secondary small" disabled={busy}>
                      保存补充
                    </button>
                  </form>
                </details>
              )}
              <div className="card-footer">
                <SourceList sources={row.sources} />
                <div>
                  <button
                    className="text-button"
                    disabled={busy || row.status === 'withdrawn'}
                    onClick={() =>
                      void mutate('change-confirm', {
                        id: row.id,
                        requirementId: 'CC-FEEDBACK-001',
                      }).catch(() => {})
                    }
                  >
                    确认需要改进
                  </button>
                  <button
                    className="text-button muted-text"
                    disabled={busy || row.status === 'withdrawn'}
                    onClick={() =>
                      void mutate('feedback-update', {
                        id: row.id,
                        revision: row.revision,
                        status: 'withdrawn',
                      }).catch(() => {})
                    }
                  >
                    撤回
                  </button>
                  <button
                    className="text-button muted-text"
                    disabled={busy}
                    onClick={() => void mutate('delete', { id: row.id }).catch(() => {})}
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
