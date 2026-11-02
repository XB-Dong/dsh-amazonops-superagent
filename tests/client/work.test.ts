import assert from 'node:assert/strict';
import test from 'node:test';
import { messageIntent, workMessages } from '../../packages/client/work.ts';

test('network retry preserves the same message intent; edits and new requests differ', () => {
  let next = 0;
  const create = () => String(++next);
  const first = messageIntent(undefined, '复制任务', 'thread-a', create);
  assert.deepEqual(messageIntent(first, '复制任务', 'thread-a', create), first);
  assert.notEqual(messageIntent(first, '复制另一任务', 'thread-a', create).requestId, first.requestId);
  assert.notEqual(messageIntent(undefined, '复制任务', 'thread-a', create).requestId, first.requestId);
});
test('thread rendering isolates server messages and removes duplicate delivery IDs', () => {
  const a = { id: 'one', threadId: 'a', role: 'assistant' as const, text: '草稿已准备', at: '' };
  const b = { ...a, id: 'two', threadId: 'b' };
  assert.deepEqual(workMessages({ tickets: [], messages: [a, a, b] }, 'a'), [a]);
  assert.deepEqual(workMessages({ tickets: [], messages: [a] }, undefined), []);
});
