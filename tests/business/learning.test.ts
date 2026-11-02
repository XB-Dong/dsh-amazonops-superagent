import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../packages/business/core/store.ts';
import { Learning, type Task, type Memory } from '../../packages/business/learning/service.ts';
import { Capture } from '../../packages/business/learning/capture.ts';
import { confirmChange, exportChanges } from '../../packages/business/learning/export.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-learning-'));
  const store = new Store(join(dir, 'business.sqlite'));
  return {
    store,
    learning: new Learning(store),
    dispose: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('negated and quoted remember statements never become confirmed facts', () => {
  const f = fixture();
  const capture = new Capture(f.store, f.learning);
  try {
    for (const [index, text] of [
      '不要记住：准备提前量是0小时',
      '别人说“记住：准备提前量是0小时”',
      '引用文件：记住：准备提前量是0小时',
    ].entries())
      capture.enqueue('a', text, `negative-${index}`);
    capture.drain('a');
    assert.equal(f.learning.context('a').facts.length, 0);
    capture.enqueue('a', '请记住：准备提前量是6小时', 'affirmative');
    capture.drain('a');
    assert.equal(f.learning.context('a').facts[0].value, '6小时');
  } finally {
    f.dispose();
  }
});
test('withdrawn feedback is excluded from confirmed requirements export', () => {
  const f = fixture();
  try {
    const source = f.store.source('a', '页面不好用');
    const feedback = f.learning.feedback('a', source.id, { text: source.text })!;
    confirmChange(f.store, 'a', feedback.id, 'CC-FEEDBACK-001');
    f.store.update(feedback, { status: 'withdrawn' });
    const directory = mkdtempSync(join(tmpdir(), 'cc-export-'));
    try {
      assert.equal(exportChanges(f.store, 'a', directory).changes.length, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    f.dispose();
  }
});
test('feedback deduplicates source, counts independent repeats and preserves conflicts', () => {
  const f = fixture();
  try {
    const a = f.store.source('a', '页面不好用');
    const b = f.store.source('a', '页面不好用');
    f.learning.feedback('a', a.id, { text: a.text });
    f.learning.feedback('a', a.id, { text: a.text });
    const merged = f.learning.feedback('a', b.id, { text: b.text })!;
    assert.equal(merged.count, 2);
    f.learning.feedback('a', f.store.source('a', '页面不好用').id, {
      text: a.text,
      expected: '保留原有布局',
    });
    assert.equal(f.store.list('a', 'feedback').length, 2);
    assert.throws(() => f.learning.feedback('b', a.id, { text: 'x' }), /NOT_FOUND/);
  } finally {
    f.dispose();
  }
});
test('correction survives repeated compression and deletion prevents replay resurrection', () => {
  const f = fixture();
  try {
    const a = f.store.source('a', '提前4小时');
    const b = f.store.source('a', '更正为6小时，金额100.25 USD');
    f.learning.remember('a', a.id, 'lead', '4 hours', true);
    const updated = f.learning.remember('a', b.id, 'lead', '6 hours; 100.25 USD', true)!;
    for (let index = 0; index < 4; index++) f.learning.compact('a');
    assert.equal(f.learning.context('a').facts.length, 1);
    assert.equal(f.learning.context('a').facts[0].value, '6 hours; 100.25 USD');
    const summary = f.store.list('a', 'summary')[0];
    assert.throws(() => f.learning.compact('a', summary.revision - 1), /REVISION_CONFLICT/);
    assert.equal(f.learning.context('b').facts.length, 0);
    f.learning.deleteSource('a', b.id);
    assert.equal(f.learning.context('a').facts.length, 0);
    assert.throws(() => f.learning.remember('a', b.id, 'lead', 'bad', true), /NOT_FOUND/);
    assert.throws(() => f.store.source('a', 'replay', b.id), /SOURCE_DELETED/);
    assert.equal(
      f.store.list<Memory>('a', 'memory').find((row) => row.id === updated.id),
      undefined,
    );
  } finally {
    f.dispose();
  }
});
test('only confirmed successful workflows promote; L1 waits and revocation is immediate', () => {
  const f = fixture();
  try {
    const source = f.store.source('a', '准备清单');
    let task = f.store.create('a', 'task', {
      title: '活动准备',
      status: 'open',
      checklist: ['核对站点时间', '检查当前价格'],
      checked: [true, true],
      timeZone: 'Asia/Shanghai',
      sources: [source.id],
      confirmedSuccess: false,
    }) as Task;
    assert.throws(() => f.learning.deriveSkill('a', task.id), /NOT_CONFIRMED/);
    task = f.store.update(task, { status: 'done', confirmedSuccess: true });
    const skill = f.learning.deriveSkill('a', task.id)!;
    assert.equal(skill.status, 'active');
    assert.equal(f.learning.activeSkills('b').length, 0);
    assert.equal(f.learning.deriveSkill('a', task.id, 'L1')!.status, 'waiting_confirmation');
    assert.throws(() => f.learning.deriveSkill('a', task.id, 'L2'), /FORBIDDEN/);
    f.learning.revoke('a', skill.id);
    assert.equal(f.learning.activeSkills('a').length, 0);
    f.learning.setEnabled('a', false);
    assert.equal(f.learning.feedback('a', source.id, { text: 'later' }), undefined);
  } finally {
    f.dispose();
  }
});
