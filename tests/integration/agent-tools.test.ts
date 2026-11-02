import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, AgentTools } from './review-fixtures.ts';

test('unit: consumed native followup owns stable operation and same-message payload conflicts', async () => {
  const f = fixture();
  try {
    const { row, result } = await f.ticket();
    const a = f.agent(row);
    const input = { title: '第一份草稿', timeZone: 'Asia/Shanghai', checklist: ['检查时间'] };
    const first = await a.execute('cc_prepare_task', input);
    assert.deepEqual(await a.execute('cc_prepare_task', input), first);
    await assert.rejects(a.execute('cc_prepare_task', { ...input, title: '修改后偷偷重复创建' }), /OPERATION_CONFLICT/);
    const followup = await f.source.submit('main', '再建一份相同草稿', 'next', result.threadId);
    row.inputs.push({ kind: 'trigger', id: 'actual-native-input', triggerId: followup.messageId });
    const id = 'dsh-superagent:' + createHash('sha256').update(JSON.stringify(['actual-native-input'])).digest('hex').slice(0, 32);
    for (const listener of a.listeners) listener.callback({ id: a.value.id }, { type: 'user/message', data: { id } });
    const second = await a.execute('cc_prepare_task', input);
    assert.notDeepEqual(second, first);
    const tasks = f.business.store.list('main', 'task');
    assert.equal(tasks.length, 2);
    assert.ok(tasks.some((task: any) => task.sources.includes(followup.messageId)));
    assert.ok(tasks.some((task: any) => task.sources.includes(result.messageId)));
    f.business.learning.deleteSource('main', followup.messageId);
    await assert.rejects(a.execute('cc_prepare_task', input), /REVOKED|NOT_FOUND/);
  } finally { f.dispose(); }
});

for (const mode of ['provider', 'draft'] as const) test(`unit: ${mode} loaded Skill revoke survives tool factory recreation and closes native session`, async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    const skill = f.skill();
    const a = f.agent(row);
    if (mode === 'provider') {
      const candidates = await a.providers[0].list();
      assert.ok(await a.providers[0].get(candidates.find((candidate: any) => candidate.locator === skill.id)));
    } else await a.execute('cc_draft_checklist', { skillId: skill.id });
    assert.equal(f.source.allowedTicket('main', row.id), true);
    f.business.learning.revoke('main', skill.id);
    const recreated = new AgentTools(f.business, () => f.runtime);
    const write = recreated.tools(a.value, row).find((tool: any) => tool.name === 'cc_prepare_task');
    await assert.rejects(write.execute({ title: '陈旧经验', timeZone: 'Asia/Shanghai', checklist: ['检查'] }, new AbortController().signal), /SKILL_REVOKED|REVOKED/);
    assert.equal(f.source.allowedTicket('main', row.id), false);
    assert.equal(f.source.sessions('main').size, 0);
    f.source.revokeDeleted();
    assert.deepEqual(f.stopped, [row.id]);
    assert.equal(f.business.store.list('main', 'task').length, 1);
    a.controller.abort();
  } finally { f.dispose(); }
});

test('unit: confirmed-memory injection records actual lineage and deleting it retires historical native context', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    const origin = f.business.store.source('main', '请记住：准备提前量为6小时');
    const fact = f.business.learning.remember('main', origin.id, '提前量', '6小时', true);
    const a = f.agent(row);
    const text = a.contexts.get('cc-confirmed-memory').text();
    assert.match(text, /6小时/);
    const binding = f.business.store.get('main', `native-binding:${a.value.id}`);
    assert.ok(binding.sources.includes(fact.id));
    assert.ok(binding.sources.includes(origin.id));
    const revision = binding.revision;
    assert.equal(a.contexts.get('cc-confirmed-memory').text(), text);
    assert.equal(f.business.store.get('main', binding.id).revision, revision);
    f.business.learning.deleteSource('main', origin.id);
    assert.equal(f.source.allowedTicket('main', row.id), false);
    assert.equal(f.source.sessions('main').size, 0);
    assert.throws(() => a.contexts.get('cc-confirmed-memory').text(), /REVOKED|NOT_FOUND/);
    await assert.rejects(a.execute('cc_prepare_task', { title: '旧记忆', timeZone: 'Asia/Shanghai', checklist: ['检查'] }), /REVOKED|NOT_FOUND/);
    f.source.revokeDeleted();
    assert.deepEqual(f.stopped, [row.id]);
    a.controller.abort();
  } finally { f.dispose(); }
});

for (const kind of ['memory', 'task-detail', 'task-list', 'operations'] as const)
  test(`unit: actual ${kind} tool result joins native privacy lineage before returning`, async () => {
    const f = fixture();
    try {
      const { row } = await f.ticket();
      const origin = f.business.store.source('main', '独立业务资料来源');
      let entity: any;
      let tool: string;
      let args: any;
      if (kind === 'memory') {
        entity = f.business.learning.remember('main', origin.id, '独立事实', '工具读取的确认事实', true);
        tool = 'cc_read_memory'; args = {};
      } else if (kind === 'operations') {
        entity = f.business.store.create('main', 'shipment', { store: '店铺A', listing: '链接A',
          quantity: 10, received: 0, status: 'planned', shipDate: '2026-01-01', sources: [origin.id] });
        tool = 'cc_read_operations'; args = {};
      } else {
        entity = f.business.tasks.create('main', 'independent-task', { title: '独立业务任务', timeZone: 'Asia/Shanghai',
          checklist: ['独立来源步骤'], sourceId: origin.id });
        tool = kind === 'task-detail' ? 'cc_get_task' : 'cc_list_tasks';
        args = kind === 'task-detail' ? { taskId: entity.id } : {};
      }
      const a = f.agent(row);
      // No prompt context callback was called: this lineage originates only in the tool result.
      const value = await a.execute(tool, args);
      assert.ok(JSON.stringify(value).includes(entity.id));
      f.business.learning.deleteSource('main', origin.id);
      assert.equal(f.source.allowedTicket('main', row.id), false);
      await assert.rejects(a.execute('cc_prepare_task', { title: '沿用已删资料', timeZone: 'Asia/Shanghai', checklist: ['检查'] }), /REVOKED|NOT_FOUND/);
      a.controller.abort();
    } finally { f.dispose(); }
  });

test('unit: Skill search summary consumption is revoked before another model operation', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    const skill = f.skill();
    const a = f.agent(row);
    const result = await a.execute('cc_find_skills', { query: '准备活动' });
    assert.ok(result.skills.some((candidate: any) => candidate.id === skill.id));
    f.business.learning.revoke('main', skill.id);
    assert.equal(f.source.allowedTicket('main', row.id), false);
    await assert.rejects(a.execute('cc_prepare_task', { title: '旧经验摘要', timeZone: 'Asia/Shanghai', checklist: ['检查'] }), /REVOKED|SKILL_REVOKED/);
    a.controller.abort();
  } finally { f.dispose(); }
});

test('unit: provider catalog metadata alone retains the consumed Skill version', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    const skill = f.skill();
    const a = f.agent(row);
    const candidates = await a.providers[0].list();
    assert.ok(candidates.some((candidate: any) => candidate.locator === skill.id));
    f.business.learning.revoke('main', skill.id);
    assert.equal(f.source.allowedTicket('main', row.id), false);
    await assert.rejects(a.execute('cc_read_memory', {}), /REVOKED|SKILL_REVOKED/);
    a.controller.abort();
  } finally { f.dispose(); }
});
