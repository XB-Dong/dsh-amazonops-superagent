import test from 'node:test';
import assert from 'node:assert/strict';
import * as work from '../../packages/client/work.ts';
import type { WorkTicket } from '../../packages/contracts/model.ts';
import { stableFormIntent } from '../../packages/client/assistant-state.ts';

const ticket: WorkTicket = { id: 'one', title: '合成库存复核', status: 'waiting', updatedAt: '2026-11-05T01:00:00.000Z',
  attention: { id: 'question-one', question: '选择方案A或B？' }, actions: ['supplement', 'answer', 'stop'] };

test('reply drafts preserve the original native version and attention across refreshed projections', () => {
  const api = work as any;
  const opened = api.openWorkDraft({}, ticket, 'answer', () => 'request-one');
  const key = api.workDraftKey(ticket, 'answer');
  const edited = api.changeWorkDraft(opened, key, '选择方案A', () => 'request-two');
  const newer = { ...ticket, updatedAt: '2026-11-05T02:00:00.000Z' };
  const retained = api.openWorkDraft(edited, newer, 'answer', () => 'request-three');
  assert.equal(retained[key].expectedUpdatedAt, ticket.updatedAt);
  assert.equal(retained[key].attentionId, 'question-one');
  assert.equal(retained[key].text, '选择方案A');
  assert.equal(retained[key].requestId, 'request-two');
  assert.deepEqual(api.workActionPayload(retained[key]), { ticketId: 'one', action: 'answer', requestId: 'request-two',
    expectedUpdatedAt: ticket.updatedAt, attentionId: 'question-one', text: '选择方案A' });
  assert.equal(api.closeWorkDraft(retained, key)[key], undefined);
});

test('a new attention receives a separate draft and failed request identity is retained', () => {
  const api = work as any;
  const first = api.openWorkDraft({}, ticket, 'answer', () => 'one');
  const firstKey = api.workDraftKey(ticket, 'answer');
  const edited = api.changeWorkDraft(first, firstKey, '暂存答复', () => 'two');
  assert.equal(api.changeWorkDraft(edited, firstKey, '暂存答复', () => 'unused')[firstKey].requestId, 'two');
  const newer = { ...ticket, attention: { id: 'question-two', question: '新的问题' } };
  const next = api.openWorkDraft(edited, newer, 'answer', () => 'three');
  assert.notEqual(api.workDraftKey(newer, 'answer'), firstKey);
  assert.equal(next[firstKey].text, '暂存答复');
  assert.equal(next[api.workDraftKey(newer, 'answer')].text, '');
});

test('a late successful reply cannot clear text edited after that request was sent', () => {
  const api = work as any;
  const opened = api.openWorkDraft({}, ticket, 'answer', () => 'first');
  const key = api.workDraftKey(ticket, 'answer');
  const sent = api.changeWorkDraft(opened, key, '第一版答复', () => 'sent');
  const edited = api.changeWorkDraft(sent, key, '编辑后的答复', () => 'newer');
  assert.equal(api.acknowledgeWorkDraft(edited, key, 'sent')[key].text, '编辑后的答复');
  assert.equal(api.acknowledgeWorkDraft(sent, key, 'sent')[key], undefined);
});

test('failed finite watch and rule submissions keep identity until their actual inputs change', () => {
  const body = { inventoryId: 'explicit-one', expiresAt: '2030-01-01T01:00:00.000Z' };
  const first = stableFormIntent(undefined, body, () => 'first');
  assert.equal(stableFormIntent(first, { ...body }, () => 'unused').requestId, 'first');
  assert.equal(stableFormIntent(first, { ...body, inventoryId: 'explicit-two' }, () => 'changed').requestId, 'changed');
  assert.equal(stableFormIntent(undefined, { mode: 'observe', inventoryIds: [] }, () => 'rule').fingerprint,
    JSON.stringify({ mode: 'observe', inventoryIds: [] }));
});

test('human controls follow current native actions, never guessed legacy status', () => {
  const api = work as any;
  assert.deepEqual(api.availableWorkActions(ticket), ['supplement', 'answer', 'stop']);
  assert.deepEqual(api.availableWorkActions({ ...ticket, actions: undefined }), []);
  assert.deepEqual(api.availableWorkActions({ ...ticket, updatedAt: undefined }), []);
  assert.equal(api.workStageLabel({ ...ticket, stage: { stage: 'person', action: 'answer' } }), '等待你作决定');
  assert.equal(api.workStageLabel({ ...ticket, stage: { stage: 'idle' } }), '等待后续变化');
});

test('finite watch input rejects missing/past dates and preserves explicit inventory selection', () => {
  const api = work as any;
  const now = Date.parse('2026-11-05T00:00:00.000Z');
  assert.throws(() => api.watchExpiry('', now), /结束时间/);
  assert.throws(() => api.watchExpiry('2020-01-01T12:00', now), /晚于/);
  assert.throws(() => api.watchExpiry('not-a-date', now), /结束时间/);
  const expiry = api.watchExpiry('2030-01-01T12:00', now);
  assert.equal(Number.isFinite(Date.parse(expiry)), true);
});
