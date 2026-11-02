import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,WorkbenchSource } from './review-fixtures.ts';

for(const boundary of ['before-native-commit','after-native-commit'] as const)
test(`fault: stable human receipt recovers a lost response ${boundary}`,async()=>{
  const f=fixture();
  try{
    const normal=f.runtime.context;
    f.runtime.context=()=>({receive:async(trigger:any)=>{
      if(boundary==='after-native-commit')await normal().receive(trigger);
      throw new Error('SIMULATED_RECEIPT_CURSOR_LOSS');
    }});
    await assert.rejects(f.source.submit('main','创建合成清单','cursor-recovery'),/SIMULATED_RECEIPT_CURSOR_LOSS/);
    const source=f.business.store.list('main','source')[0];
    const committed=f.triggers.get(source.id);
    assert.equal(f.business.store.list('main','source').length,1);
    f.runtime.context=normal;
    const resumed=new WorkbenchSource(f.runtime,f.business);
    const receipt=await resumed.submit('main','创建合成清单','cursor-recovery');
    assert.equal(receipt.messageId,source.id);
    assert.equal(f.business.store.list('main','source').length,1);
    assert.equal(f.triggers.size,1);
    if(committed)assert.equal(f.triggers.get(source.id),committed,'A replay must retain the actual native trigger timestamp and payload');
  }finally{f.dispose();}
});

test('unit: sensitive original text is rejected before business persistence or native admission', async () => {
  const f = fixture();
  try {
    const before = f.business.store.db.prepare('SELECT total_changes() AS count').get()!.count;
    for (const text of ['sk-' + 'a'.repeat(24), 'password=' + 'example-only-value', ' ', 'x'.repeat(2001)])
      await assert.rejects(f.source.submit('main', text, 'invalid'), /SENSITIVE_INPUT_BLOCKED|INVALID_TEXT/);
    assert.equal(f.received.length, 0);
    assert.equal(f.business.store.list('main', 'source').length, 0);
    assert.equal(f.business.store.db.prepare('SELECT total_changes() AS count').get()!.count, before);
  } finally { f.dispose(); }
});

test('unit: human retry keeps source identity and conflicting payload never enters native runtime', async () => {
  const f = fixture();
  try {
    const first = await f.source.submit('main', '准备清单', 'stable');
    assert.deepEqual(await f.source.submit('main', '准备清单', 'stable'), first);
    assert.equal(f.business.store.list('main', 'source').length, 1);
    const received = f.received.length;
    await assert.rejects(f.source.submit('main', '不同清单', 'stable'), /REQUEST_CONFLICT/);
    assert.equal(f.received.length, received);
    f.business.learning.deleteSource('main', first.messageId);
    await assert.rejects(f.source.submit('main', '准备清单', 'stable'), /NOT_FOUND|REVOKED/);
  } finally { f.dispose(); }
});

test('unit: derived business events are not eligible for native evaluation', async () => {
  const f = fixture();
  try {
    const kind = f.kinds[0];
    assert.equal(kind.scope({ meta: { scope: 'main', eventClass: 'human_request' } }).listened, true);
    for (const eventClass of ['business_event', 'capture', 'summary', 'workflow', 'assistant', 'tool_result'])
      assert.equal(kind.scope({ meta: { scope: 'main', eventClass } }).listened, false);
    assert.equal(kind.scope({ meta: { scope: 'other', eventClass: 'human_request' } }).listened, false);
    f.business.store.appendEvent('main', 'task.changed');
    f.business.tick('main');
    assert.equal(f.received.length, 0);
  } finally { f.dispose(); }
});

test('unit: deleting a followup closes ticket lineage, native sessions and delivery', async () => {
  const f = fixture();
  try {
    const { row, result } = await f.ticket();
    const followup = await f.source.submit('main', '补充检查预算', 'followup', result.threadId);
    row.inputs.push({ id: 'input-followup', kind: 'trigger', triggerId: followup.messageId });
    assert.equal(f.source.allowedTicket('main', row.id), true);
    f.business.learning.deleteSource('main', followup.messageId);
    assert.equal(f.source.allowedTicket('main', row.id), false);
    assert.equal(f.source.sessions('main').size, 0);
    assert.equal(await f.kinds[0].channel.send({}, { id: 'delivery', ticketId: row.id,
      channel: { source: 'amazonops', thread: result.threadId, address: { scope: 'main' } }, text: 'old answer' }), 'gone');
    f.source.revokeDeleted();
    assert.deepEqual(f.stopped, [row.id]);
  } finally { f.dispose(); }
});

test('unit: work projection is a pure query and delivery receipt contains metadata only', async () => {
  const f = fixture();
  try {
    const { row, result } = await f.ticket();
    const message = { id: 'answer', ticketId: row.id, text: '模型回答正文', status: 'sent',
      channel: { source: 'amazonops', thread: result.threadId, address: { scope: 'main' } } };
    assert.equal(await f.kinds[0].channel.send({}, message), 'sent');
    f.db.prepare('INSERT INTO outbox(value) VALUES (?)').run(JSON.stringify(message));
    const receipt = f.business.store.db.prepare('SELECT result FROM receipts WHERE request_key=?').get('native-delivery:answer')!;
    assert.deepEqual(Object.keys(JSON.parse(String(receipt.result))), ['at']);
    const before = f.business.store.db.prepare('SELECT total_changes() AS count').get()!.count;
    const first = f.source.work('main');
    assert.deepEqual(f.source.work('main'), first);
    assert.equal(first.messages.find((row: any) => row.id === 'answer')?.text, message.text);
    assert.equal(f.business.store.db.prepare('SELECT total_changes() AS count').get()!.count, before);
  } finally { f.dispose(); }
});
