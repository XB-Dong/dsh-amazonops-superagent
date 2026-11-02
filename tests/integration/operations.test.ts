import test from 'node:test';
import assert from 'node:assert/strict';
import { admitEvent, StableOperations, type IntentStore } from '../../packages/host/operations.ts';

class MemoryIntents implements IntentStore {
  values = new Map<string, unknown>();
  once<T>(scope: string, key: string, create: () => T): T {
    const id = JSON.stringify([scope,key]);
    if (!this.values.has(id)) this.values.set(id, create());
    return this.values.get(id) as T;
  }
}
test('only trusted human conversational requests are admitted', () => {
  assert.equal(admitEvent({eventClass:'human_request', actorKind:'human', authenticated:true, scope:'main'}), true);
  for (const eventClass of ['business_event','feedback','tick','assistant_receipt','tool_result'])
    assert.equal(admitEvent({eventClass,actorKind:'human',authenticated:true,scope:'main'}),false);
  assert.equal(admitEvent({eventClass:'human_request',actorKind:'bot',authenticated:true,scope:'main'}),false);
  assert.equal(admitEvent({eventClass:'human_request',actorKind:'human',authenticated:false,scope:'main'}),false);
});
test('one logical operation survives a new adapter/Assignment instance', () => {
  const store=new MemoryIntents();
  const first=new StableOperations(store).resolve('main','message-1','copy',{taskId:'t1',revision:1});
  assert.equal(new StableOperations(store).resolve('main','message-1','copy',{revision:1,taskId:'t1'}),first);
});
test('payload change in one intent conflicts while new user requests remain distinct', () => {
  const operations=new StableOperations(new MemoryIntents());
  const first=operations.resolve('main','message-1','copy',{taskId:'t1'});
  assert.throws(()=>operations.resolve('main','message-1','copy',{taskId:'t2'}),/OPERATION_CONFLICT/);
  assert.notEqual(operations.resolve('main','message-2','copy',{taskId:'t1'}),first);
  assert.notEqual(operations.resolve('main','message-1','copy',{taskId:'t1'},'authorized-second'),first);
});
