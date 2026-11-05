import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './review-fixtures.ts';
import { followupToolGuard,permittedBusinessTrigger } from '../../packages/host/followup-native-authority.ts';
import { AgentTools } from '../../packages/host/agent-tools.ts';
import { privacyHooks } from '../../packages/host/privacy.ts';

function seed(f: ReturnType<typeof fixture>) {
  const forecast = f.business.command('main','forecast',{requestId:'forecast-initial',store:'Synthetic',site:'US',listing:'A',
    asOf:'2026-11-05',manualDaily:5,manualReason:'Synthetic native test'});
  return f.business.command('main','inventory',{forecastId:forecast.id,physicalSku:'A',asOf:'2026-11-05',available:12,
    reserved:0,inbound:[],leadDays:{purchase:1,transport:2,receiving:1},safetyDays:2,horizon:7,demandFactors:[]});
}
test('unit: a missing assessment trigger gives a corrective error without granting authority',()=>{
  const f=fixture();try{
    const guard=privacyHooks(f.business,()=>f.runtime,()=>f.source,new AgentTools(f.business,()=>f.runtime));
    for(const name of ['orchestrator_eval','orchestrator_eval_decide']){
      assert.throws(()=>guard.authorizeTool({} as any,undefined,name,{decision:'accept'}),/MISSING_TRIGGER_ID/);
      assert.throws(()=>guard.authorizeTool({} as any,undefined,name,{trigger_id:'forged'}),/SOURCE_FORBIDDEN/);
    }
    assert.equal(f.tickets.size,0);
  }finally{f.dispose();}
});
test('unit: authenticated finite watch creates one human source and native request with stable intent',async()=>{
  const f=fixture();try{
    const inventory=seed(f);
    const input={requestId:'watch-native',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()};
    const first=await (f.source as any).followups.createWatch('main',input);
    const second=await (f.source as any).followups.createWatch('main',input);
    assert.equal(first.id,second.id);assert.equal(f.triggers.size,1);
    const trigger=f.triggers.get(first.sourceId)!;
    assert.equal(trigger.human,true);assert.equal(trigger.meta.watchId,first.id);
    assert.equal(f.business.store.list('main','job').length,0,'authorization is not feedback capture');
    await assert.rejects((f.source as any).followups.createWatch('main',{...input,title:'Changed'}),/REQUEST_CONFLICT/);
  }finally{f.dispose();}
});
test('unit: untrusted derived metadata cannot enter the new Source admission',()=>{
  const f=fixture();try{
    for(const eventClass of ['watch_update','risk_candidate'])
      assert.equal(f.kinds[0].scope({meta:{scope:'main',eventClass,eventId:'forged'}}).listened,false);
    assert.equal(f.kinds[0].scope({meta:{scope:'other',eventClass:'human_request'}}).listened,false);
  }finally{f.dispose();}
});

test('unit: deleting a watch authorization erases a draft derived from its later human answer',async()=>{
  const f=fixture();try{
    const inventory=seed(f),watch=await f.source.followups.createWatch('main',
      {requestId:'derived-privacy',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const row:any={id:'privacy-watch-ticket',origin:{triggerId:watch.sourceId,triggerIds:[watch.sourceId]},
      inputs:[],assignments:[],updatedAt:new Date().toISOString()};f.tickets.set(row.id,row);
    const answer=await f.source.submit('main','同意创建合成复核草稿。','derived-answer',`watch-${watch.id}`);
    const task=f.business.tool('main',answer.messageId,'prepare_task',
      {title:'合成库存复核',timeZone:'Asia/Shanghai',checklist:['人工核对风险']},'derived-task');
    assert.equal(f.business.snapshot('main').tasks.length,1);
    f.business.learning.deleteSource('main',watch.sourceId);
    assert.equal(f.business.snapshot('main').tasks.length,0,'a later human answer must retain its original authorized context lineage');
    assert.throws(()=>f.business.store.get('main',task.id),/NOT_FOUND/);
  }finally{f.dispose();}
});
test('unit: automatic activation needs trusted evidence and never follows request payload claims',async()=>{
  const f=fixture();try{
    const inventory=seed(f);
    await assert.rejects((f.source as any).followups.configureRule('main',
      {requestId:'rule-auto',mode:'auto',inventoryIds:[inventory.id],autoAvailable:true},{autoAvailable:false}),/AUTO_NOT_VALIDATED/);
    assert.equal(f.business.store.list('main','inventory-rule').length,0);
  }finally{f.dispose();}
});

test('unit: followup draft writes require a fresh authoritative risk read, not an old model context',async()=>{
  const f=fixture();try{
    const inventory=seed(f),watch=await f.source.followups.createWatch('main',{requestId:'fresh-risk',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const trigger=f.triggers.get(watch.sourceId)!;
    const row:any={id:'fresh-ticket',origin:{triggerId:trigger.id,triggerIds:[trigger.id]},inputs:[],assignments:[],updatedAt:new Date().toISOString()};
    f.tickets.set(row.id,row);
    assert.throws(()=>followupToolGuard(f.business,f.runtime,row,'cc_prepare_task',{}),/WATCH_FACTS_NOT_READ/);
  }finally{f.dispose();}
});

test('unit: durable business delivery is once, attention holds it and ended work cannot restart',async()=>{
  const f=fixture();try{
    const inventory=seed(f),watch=await f.source.followups.createWatch('main',{requestId:'event-once',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const row:any={id:'native-watch-ticket',origin:{triggerId:watch.sourceId,triggerIds:[watch.sourceId]},inputs:[],assignments:[{id:'a',state:'running',report:{state:'waiting'}}],updatedAt:new Date().toISOString()};
    f.tickets.set(row.id,row);await f.source.followups.pump('main');
    const change=(requestId:string,manualDaily:number)=>f.business.command('main','forecast',{requestId,store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily,manualReason:'Synthetic changed risk'});
    change('change-one',8);await f.source.followups.pump('main');
    assert.equal(f.received.length,2);await f.source.followups.pump('main');assert.equal(f.received.length,2);
    const eventTrigger=f.received[1];assert.equal(permittedBusinessTrigger(f.business,eventTrigger),true);
    assert.equal(permittedBusinessTrigger(f.business,{...eventTrigger,actor:{source:'amazonops',id:'forged'}}),false);
    row.delivery={error:'Synthetic delivery requires a person',at:new Date().toISOString()};
    change('change-two',9);await f.source.followups.pump('main');assert.equal(f.received.length,2,'person/delivery does not accept another automatic input');
    delete row.delivery;row.attention={id:'attention',question:'Choose'};await f.source.followups.pump('main');assert.equal(f.received.length,2);
    row.ended={outcome:'completed',by:'executor'};await f.source.followups.pump('main');
    assert.equal(f.source.followups.domain.get('main',watch.id).status,'completed');assert.equal(f.received.length,2);
  }finally{f.dispose();}
});

test('unit: expiry and a negated human completion message cannot grant continued or completed execution',async()=>{
  const f=fixture();try{
    const inventory=seed(f),watch=await f.source.followups.createWatch('main',{requestId:'expiry-native',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const row:any={id:'expiring-ticket',origin:{triggerId:watch.sourceId,triggerIds:[watch.sourceId]},inputs:[],assignments:[],updatedAt:new Date().toISOString()};
    f.tickets.set(row.id,row);
    const followup=await f.source.submit('main','不要完成跟进，继续原来的工作。','not-completion',`watch-${watch.id}`);
    row.inputs.push({id:'negated',kind:'trigger',human:true,triggerId:followup.messageId});
    assert.throws(()=>followupToolGuard(f.business,f.runtime,row,'orchestrator_report',{state:'ready'}),/WATCH_REQUIRES_WAITING/);
    const record=f.source.followups.domain.record('main',watch.id);
    f.business.store.update(record,{expiresAt:new Date(Date.now()-1).toISOString()});
    assert.throws(()=>followupToolGuard(f.business,f.runtime,row,'cc_read_watch',{}),/WATCH_EXPIRED/);
    await f.source.followups.pump('main');assert.deepEqual(f.stopped,[row.id]);
    assert.equal(f.source.followups.domain.get('main',watch.id).status,'expired');
  }finally{f.dispose();}
});

test('unit: routing model reads the current authoritative rule identifiers and mode on every step',()=>{
  const f=fixture();try{
    let mode='observe';(f.runtime.store as any).settings=()=>({eval:{mode},policy:{rules:[{id:'inventory-risk-review',enabled:true,instruction:'内部复核'}]}});
    const contexts=new Map<string,any>();const agent:any={id:'master',ctx:{systemPrompt:{section:()=>()=>{},context:(value:any)=>{contexts.set(value.name,value);return ()=>{};}}}};
    new AgentTools(f.business,()=>f.runtime).onAgent(agent);
    const policy=contexts.get('amazonops-current-policy');
    assert.ok(policy,'operations prompt must not hide actual rule IDs from real model assessment');
    assert.match(policy.text(),/inventory-risk-review/);assert.match(policy.text(),/observe/);
    mode='auto';assert.match(policy.text(),/auto/);
  }finally{f.dispose();}
});

test('unit: current watch trigger remains readable across two risk transitions without granting stale writes',async()=>{
  const f=fixture();try{
    const inventory=seed(f),watch=await f.source.followups.createWatch('main',{requestId:'history-native',inventoryId:inventory.id,expiresAt:new Date(Date.now()+86400000).toISOString()});
    const row:any={id:'history-ticket',origin:{triggerId:watch.sourceId,triggerIds:[watch.sourceId]},inputs:[],assignments:[{id:'a',state:'running',report:{state:'waiting'}}],updatedAt:new Date().toISOString()};
    f.tickets.set(row.id,row);await f.source.followups.pump('main');
    for(const quantity of [8,9]){
      f.business.command('main','forecast',{requestId:`history-${quantity}`,store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily:quantity,manualReason:'Synthetic history update'});
      await f.source.followups.pump('main');const event=f.received.at(-1);
      row.inputs.push({id:`input-${quantity}`,kind:'trigger',triggerId:event.id});
    }
    const agent=f.agent(row),current=f.received.at(-1);
    const hooks=privacyHooks(f.business,()=>f.runtime,()=>f.source,agent.tools);
    assert.doesNotThrow(()=>hooks.authorizeTool(agent.value,row,'orchestrator_read',{resource:`trigger/${current.id}`}));
    assert.throws(()=>followupToolGuard(f.business,f.runtime,row,'cc_prepare_task',{}),/WATCH_FACTS_NOT_READ/);
    const prior=f.received[1];f.business.learning.deleteSource('main',prior.id);
    assert.throws(()=>hooks.authorizeTool(agent.value,row,'orchestrator_read',{resource:`trigger/${current.id}`}),/SOURCE_FORBIDDEN|DERIVATION_REVOKED/);
  }finally{f.dispose();}
});
