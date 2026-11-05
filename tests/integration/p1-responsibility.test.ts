import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './review-fixtures.ts';

test('unit: native responsibility projection exposes current authorization, attention and assignment', async () => {
  const f = fixture();
  try {
    const { row, result } = await f.ticket();
    row.createdAt = row.updatedAt;
    row.mandate = { scope: '仅核对内部清单', strength: 'explicit', policyVersion: 'policy-one' };
    row.assignments = [{ id: 'assignment-one', state: 'running', report: { state: 'waiting', summary: '等待cc选择', at: row.updatedAt } }];
    row.attention = { id: 'attention-one', question: '选择方案A还是B？' };
    const projected = f.source.work('main').tickets[0];
    assert.deepEqual(projected.stage, { stage: 'person', action: 'answer' });
    assert.deepEqual(projected.mandate, row.mandate);
    assert.equal(projected.assignment?.id, 'assignment-one');
    assert.deepEqual(projected.attention, row.attention);
    assert.equal(projected.source?.threadId, result.threadId);
    assert.deepEqual(projected.actions, ['supplement', 'answer', 'stop']);
    assert.equal(f.business.store.list('main', 'task').length, 0);
  } finally { f.dispose(); }
});

test('unit: responsibility pagination reads native tickets without losing older work', async () => {
  const f = fixture();
  try {
    await f.ticket('第一份合成清单', 'one'); await f.ticket('第二份合成清单', 'two');
    const first = f.source.work('main', { offset: 0, limit: 1 });
    const second = f.source.work('main', { offset: 1, limit: 1 });
    assert.equal(first.tickets.length, 1); assert.equal(second.tickets.length, 1);
    assert.notEqual(first.tickets[0].id, second.tickets[0].id);
    assert.deepEqual(first.pagination, { offset: 0, total: 2, nextOffset: 1 });
    assert.equal(second.pagination?.nextOffset, null);
    assert.throws(() => f.source.work('main', { offset: -1, limit: 1 }), /INVALID_OFFSET/);
  } finally { f.dispose(); }
});

test('unit: human actions enforce attention/version and stable intent before native input', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    row.attention = { id: 'question-one', question: '选择哪一项？' };
    const action = { ticketId: row.id, requestId: 'answer-one', action: 'answer',
      expectedUpdatedAt: row.updatedAt, attentionId: 'question-one', text: '选择合成方案A' };
    await assert.rejects((f.source as any).action('main', { ...action, attentionId: 'stale' }), /STALE_ATTENTION/);
    const before = f.received.length;
    const response = await (f.source as any).action('main', action);
    assert.equal(f.received.length, before + 1);
    assert.deepEqual(await (f.source as any).action('main', action), response);
    assert.equal(f.received.length, before + 1, 'a receipt replay must not deliver another native input');
    await assert.rejects((f.source as any).action('main', { ...action, text: '另一个答案' }), /REQUEST_CONFLICT/);
    await assert.rejects((f.source as any).action('other', { ...action, requestId: 'cross' }), /NOT_FOUND/);
  } finally { f.dispose(); }
});

test('unit: stop reaches the actual native command once and stale versions fail closed', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    const action = { ticketId: row.id, requestId: 'stop-once', action: 'stop', expectedUpdatedAt: row.updatedAt };
    await assert.rejects((f.source as any).action('main', { ...action, expectedUpdatedAt: 'old' }), /STALE_TICKET/);
    const response = await (f.source as any).action('main', action);
    assert.deepEqual(await (f.source as any).action('main', action), response);
    assert.deepEqual(f.stopped, [row.id]);
  } finally { f.dispose(); }
});

test('fault: an answer committed to native intake survives a lost response without a second input', async () => {
  const f = fixture();
  try {
    const { row } = await f.ticket();
    row.attention = { id: 'question-recover', question: '继续吗？' };
    const receive = f.runtime.context;
    f.runtime.context = () => ({ receive: async (trigger: unknown) => {
      await receive().receive(trigger);
      row.updatedAt = '2026-01-02T00:00:00.000Z';
      throw new Error('SIMULATED_NATIVE_COMMITTED_RESPONSE_LOSS');
    } });
    const action = { ticketId: row.id, requestId: 'answer-recover', action: 'answer',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z', attentionId: 'question-recover', text: '继续合成检查' };
    await assert.rejects((f.source as any).action('main', action), /SIMULATED_NATIVE_COMMITTED_RESPONSE_LOSS/);
    const count = f.received.length;
    f.runtime.context = receive;
    const result = await (f.source as any).action('main', action);
    assert.equal(f.received.length, count);
    assert.equal(result.messageId, 'human-work-action-answer-recover');
    assert.deepEqual(await (f.source as any).action('main', action), result);
  } finally { f.dispose(); }
});
