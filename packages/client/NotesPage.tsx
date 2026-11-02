import { useState, type FormEvent } from 'react';
import type { Note } from '../contracts/model.ts';
import type { Snapshot } from './api.ts';
import { requestId } from './api.ts';
import { Empty, Icon } from './components.tsx';
import type { Mutate } from './TasksPage.tsx';
import './p41-notes.css';

type Editor = { id?: string; revision?: number; title: string; content: string; requestId: string };
const blank = (): Editor => ({ title: '', content: '', requestId: requestId() });
export function NotesPage({
  data,
  mutate,
  busy,
}: {
  data: Snapshot & { notes?: Note[] };
  mutate: Mutate;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const notes = data.notes ?? [];
  const term = query.trim().toLocaleLowerCase('zh-CN');
  const rows = notes.filter((note) =>
    `${note.title}\n${note.content}`.toLocaleLowerCase('zh-CN').includes(term),
  );
  function edit(note?: Note) {
    setEditor(note ? { ...note, requestId: requestId() } : blank());
    setDeleting(null);
    setError('');
  }
  function change(field: 'title' | 'content', value: string) {
    setEditor((old) => old && { ...old, [field]: value, requestId: requestId() });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    setError('');
    try {
      if (editor.id) {
        await mutate('note-update', {
          id: editor.id,
          revision: editor.revision,
          title: editor.title,
          content: editor.content,
        });
      } else {
        await mutate('note', {
          title: editor.title,
          content: editor.content,
          requestId: editor.requestId,
        });
      }
      setEditor(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '笔记还没有保存，请稍后重试。');
    }
  }
  async function remove(note: Note) {
    if (busy) return;
    setError('');
    try {
      await mutate('note-delete', { id: note.id, revision: note.revision });
      if (editor?.id === note.id) setEditor(null);
      setDeleting(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '笔记还没有删除，请稍后重试。');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">学到的东西，随手记下来</span>
          <h1>学习笔记</h1>
          <p>记录知识、心得和小技巧，需要时再找回来。</p>
        </div>
        <button className="primary" disabled={busy || !!editor} onClick={() => edit()}>
          <Icon name="plus" size={17} /> 新建笔记
        </button>
      </div>
      <p className="metadata notes-hint">
        笔记由你手动保存，不会自动发给助手。暂停自动学习也可使用。
      </p>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {editor && (
        <form className="panel notes-editor" onSubmit={(event) => void submit(event)}>
          <h2>{editor.id ? '编辑笔记' : '新建笔记'}</h2>
          <label htmlFor="note-title">
            笔记标题
            <input
              id="note-title"
              value={editor.title}
              onChange={(event) => change('title', event.target.value)}
              required
              maxLength={200}
              disabled={busy}
              placeholder="例如：今天学会的库存核对方法"
            />
          </label>
          <label htmlFor="note-content">
            笔记内容
            <textarea
              id="note-content"
              value={editor.content}
              onChange={(event) => change('content', event.target.value)}
              required
              maxLength={10000}
              rows={7}
              disabled={busy}
              placeholder="写下学到的东西……"
            />
          </label>
          <div className="form-actions">
            <span className="metadata">支持分行，最多一万字。请勿填写密码等敏感信息。</span>
            <div className="notes-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditor(null);
                  setError('');
                }}
              >
                取消编辑
              </button>
              <button
                className="primary"
                disabled={busy || !editor.title.trim() || !editor.content.trim()}
              >
                保存笔记
              </button>
            </div>
          </div>
        </form>
      )}
      <div className="notes-search">
        <label htmlFor="notes-search">
          查找笔记
          <input
            id="notes-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或内容"
          />
        </label>
        <span className="metadata">{rows.length} 篇笔记</span>
      </div>
      {!rows.length ? (
        <section className="panel">
          <Empty
            icon="book"
            title={term ? '没有找到相关笔记' : '还没有学习笔记'}
            text={
              term ? '换个关键词，或者清空搜索再看看。' : '点“新建笔记”，把今天学到的东西记下来。'
            }
          />
        </section>
      ) : (
        <div className="card-list">
          {rows.map((note) => (
            <article className="panel note-card" key={note.id}>
              <h2>{note.title}</h2>
              <p className="metadata">更新于 {new Date(note.updatedAt).toLocaleString('zh-CN')}</p>
              <p className="note-content">{note.content}</p>
              <div className="notes-actions">
                {deleting === note.id ? (
                  <>
                    <span>确定删除这篇笔记吗？</span>
                    <button
                      className="secondary small"
                      disabled={busy}
                      onClick={() => setDeleting(null)}
                    >
                      保留笔记
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void remove(note)}
                    >
                      确认删除
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="secondary small"
                      aria-label={`编辑笔记：${note.title}`}
                      disabled={busy || !!editor}
                      onClick={() => edit(note)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-button muted-text"
                      aria-label={`删除笔记：${note.title}`}
                      disabled={busy || !!editor}
                      onClick={() => {
                        setDeleting(note.id);
                        setError('');
                      }}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
