import { useId, useRef, useState, type FormEvent } from 'react';
import type { Task } from '../contracts/model.ts';
import { requestId } from './api.ts';
import type { Mutate } from './TasksPage.tsx';
import { copyPreview } from './task-list-view.ts';

export function TaskCopyForm({
  task,
  mutate,
  busy,
  onClose,
  onCopied,
}: {
  task: Task;
  mutate: Mutate;
  busy: boolean;
  onClose: () => void;
  onCopied: () => void;
}) {
  const [initial] = useState(task);
  const [key, setKey] = useState(requestId);
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const id = useId();
  let preview: ReturnType<typeof copyPreview> | undefined;
  let previewError = '';
  try {
    preview = copyPreview(initial, title, from, to);
  } catch (cause) {
    previewError = (cause as Error).message;
  }
  const disabled = busy || saving;
  function changed(update: () => void) {
    update();
    setKey(requestId());
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitting.current || !preview) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await mutate('task-copy', {
        requestId: key,
        taskId: initial.id,
        revision: initial.revision,
        ...(title ? { title } : {}),
        ...(from && to ? { replaceFrom: from, replaceTo: to } : {}),
      });
      onCopied();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <form className="panel p43-copy-form" onSubmit={submit} aria-label="复制为新任务">
      <h2>复制为新任务</h2>
      <p>原任务“{initial.title}”保持不变。新任务是待确认草稿，勾选、实际用时和旧排期都不沿用。</p>
      <p className="metadata">若原任务已更新，请取消本次复制，刷新后重新打开。</p>
      <fieldset disabled={disabled}>
        <label htmlFor={`${id}-title`}>新标题（可选，留空沿用原名）</label>
        <input
          id={`${id}-title`}
          autoFocus
          value={title}
          maxLength={200}
          onChange={(event) => changed(() => setTitle(event.target.value))}
        />
        <div className="p43-replace-fields">
          <label>
            原标识（可选）
            <input
              value={from}
              maxLength={100}
              onChange={(event) => changed(() => setFrom(event.target.value))}
            />
          </label>
          <label>
            新标识（可选）
            <input
              value={to}
              maxLength={100}
              onChange={(event) => changed(() => setTo(event.target.value))}
            />
          </label>
        </div>
        <p className="metadata">
          按原样替换标题和步骤中所有匹配文字，区分大小写。无需替换时，两项都留空。
        </p>
      </fieldset>
      <section className="p43-copy-preview" aria-label="复制预览" aria-live="polite">
        <h3>复制预览</h3>
        {preview ? (
          <>
            <strong>{preview.title}</strong>
            <ol>
              {preview.checklist.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ol>
          </>
        ) : (
          <p role="alert">{previewError}</p>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      <div className="p41-actions">
        <button className="primary" disabled={disabled || !preview} type="submit">
          {saving ? '正在复制…' : '确认复制为草稿'}
        </button>
        <button className="secondary" disabled={disabled} type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  );
}
