import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './review-fixtures.ts';
function seed(f: ReturnType<typeof fixture>) {
  f.db.exec('CREATE TABLE IF NOT EXISTS decision(value TEXT NOT NULL)');
  const forecast=f.business.command('main','forecast',{requestId:'decision-forecast',store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily:5,manualReason:'Synthetic bridge fixture'});
  return f.business.command('main','inventory',{forecastId:forecast.id,physicalSku:'A',asOf:'2026-11-05',available:12,reserved:0,inbound:[],leadDays:{purchase:1,transport:2,receiving:1},safetyDays:2,horizon:7,demandFactors:[]});
}

test('unit: native decision bridge records actual historical outcomes before replacing rule configuration',()=>{
  const f=fixture();try{
    const inventory=seed(f),human=f.business.store.source('main','Synthetic rule authority');
    f.source.followups.domain.configureRule('main',{requestId:'bridge-rule',mode:'observe',inventoryIds:[inventory.id]},human.id);
    f.source.followups.domain.scan('main');const event=f.source.followups.domain.pending('main')[0];
    const trigger:any={id:`event-${event.id}`,source:'amazonops',threads:[{source:'amazonops',id:'rule-history'}],
      actor:{source:'amazonops',id:'inventory-risk'},human:false,text:'Synthetic stored event',at:event.createdAt,
      meta:{scope:'main',eventClass:'risk_candidate',eventId:event.id}};
    f.business.store.create('main','source',{text:trigger.text,origin:'tool',sources:event.sources},trigger.id);
    f.triggers.set(trigger.id,trigger);
    f.db.prepare('INSERT INTO decision(value) VALUES (?)').run(JSON.stringify({id:'native-observed',kind:'ignore',strength:'inferred',
      triggerIds:[trigger.id],audit:{would_accept:true},at:new Date().toISOString()}));
    const recorded:any[]=[];(f.source.followups.domain as any).recordRuleDecision=(...input:any[])=>recorded.push(input);
    (f.source.followups as any).syncDecisions('main');
    assert.deepEqual(recorded,[['main',event.id,'would_accept',undefined]]);
    (f.source.followups as any).syncDecisions('main');assert.equal(recorded.length,1,'same durable native decision is applied once');
    f.db.prepare('INSERT INTO decision(value) VALUES (?)').run(JSON.stringify({id:'forged-accept',kind:'accept',strength:'inferred',triggerIds:['unknown'],ticketId:'unverified'}));
    (f.source.followups as any).syncDecisions('main');assert.equal(recorded.length,1,'unknown native source cannot mark an auto window accepted');
  }finally{f.dispose();}
});

test('unit: accepted auto window requires a native ticket with the matching decision, origin and rule mandate',()=>{
  const f=fixture();try{
    const inventory=seed(f),human=f.business.store.source('main','Synthetic auto rule authority');
    const rule=f.source.followups.domain.configureRule('main',{requestId:'bridge-auto',mode:'auto',inventoryIds:[inventory.id]},human.id);
    f.source.followups.domain.scan('main');const event=f.source.followups.domain.pending('main')[0];
    const trigger:any={id:`event-${event.id}`,source:'amazonops',threads:[{source:'amazonops',id:'auto-history'}],
      actor:{source:'amazonops',id:'inventory-risk'},human:false,text:'Synthetic auto stored event',at:event.createdAt,
      meta:{scope:'main',eventClass:'risk_candidate',eventId:event.id}};
    f.business.store.create('main','source',{text:trigger.text,origin:'tool',sources:event.sources},trigger.id);f.triggers.set(trigger.id,trigger);
    f.db.prepare('INSERT INTO decision(value) VALUES (?)').run(JSON.stringify({id:'native-accepted',kind:'accept',strength:'inferred',triggerIds:[trigger.id],ticketId:'real-ticket'}));
    const native=f.source.followups;
    native.syncDecisions('main');
    assert.equal(f.business.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE request_key LIKE 'followup-accepted-window:%'").get()!.n,0);
    const ticket:any={id:'real-ticket',decisionId:'wrong-decision',origin:{triggerId:trigger.id,triggerIds:[trigger.id]},mandate:{strength:'inferred',basis:{rules:['inventory-risk-review']}}};
    f.tickets.set(ticket.id,ticket);native.syncDecisions('main');
    assert.equal(f.business.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE request_key LIKE 'followup-accepted-window:%'").get()!.n,0);
    ticket.decisionId='native-accepted';
    ticket.origin.triggerIds=['unrelated-trigger'];native.syncDecisions('main');
    assert.equal(f.business.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE request_key LIKE 'followup-accepted-window:%'").get()!.n,0);
    ticket.origin.triggerIds=[trigger.id];ticket.mandate.basis.rules=['unrelated-rule'];native.syncDecisions('main');
    assert.equal(f.business.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE request_key LIKE 'followup-accepted-window:%'").get()!.n,0);
    ticket.mandate.basis.rules=['inventory-risk-review'];
    f.db.prepare('INSERT INTO decision(value) VALUES (?)').run(JSON.stringify({id:'native-later-ignore',kind:'ignore',strength:'inferred',triggerIds:[trigger.id]}));
    native.syncDecisions('main');native.syncDecisions('main');
    assert.equal(f.business.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE request_key LIKE 'followup-accepted-window:%'").get()!.n,1);
    const off=f.business.store.source('main','Explicitly turn off after native acceptance');
    native.domain.configureRule('main',{requestId:'bridge-off',mode:'off',inventoryIds:[inventory.id]},off.id);
    const back=f.business.store.source('main','Explicitly restore same auto risk');
    native.domain.configureRule('main',{requestId:'bridge-auto-back',mode:'auto',inventoryIds:[inventory.id]},back.id);
    native.domain.scan('main');assert.equal(native.domain.pending('main').length,0);
    assert.equal(native.domain.rule('main')!.id,rule.id);
  }finally{f.dispose();}
});

test('unit: ignored historical decisions remain recordable after current rule changes and reads do not synchronize',()=>{
  const f=fixture();try{
    const inventory=seed(f),human=f.business.store.source('main','Synthetic historical rule');
    f.source.followups.domain.configureRule('main',{requestId:'history-rule',mode:'observe',inventoryIds:[inventory.id]},human.id);
    f.source.followups.domain.scan('main');const event=f.source.followups.domain.pending('main')[0];
    const trigger:any={id:`event-${event.id}`,source:'amazonops',threads:[{source:'amazonops',id:'history'}],actor:{source:'amazonops',id:'inventory-risk'},
      human:false,text:'Synthetic ignored event',at:event.createdAt,meta:{scope:'main',eventClass:'risk_candidate',eventId:event.id}};
    f.business.store.create('main','source',{text:trigger.text,origin:'tool',sources:event.sources},trigger.id);f.triggers.set(trigger.id,trigger);
    f.db.prepare('INSERT INTO decision(value) VALUES (?)').run(JSON.stringify({id:'native-ignored',kind:'ignore',strength:'inferred',triggerIds:[trigger.id]}));
    const off=f.business.store.source('main','Turn off after observation');
    f.source.followups.domain.configureRule('main',{requestId:'history-off',mode:'off',inventoryIds:[inventory.id]},off.id);
    const changes=f.business.store.db.prepare('SELECT total_changes() n').get()!.n;
    f.source.followups.snapshot('main',{autoAvailable:false});
    assert.equal(f.business.store.db.prepare('SELECT total_changes() n').get()!.n,changes);
    f.source.followups.syncDecisions('main');
    const keys:string[]=f.business.store.db.prepare('SELECT request_key FROM receipts').all().map((r:any)=>String(r.request_key));
    assert.ok(keys.includes(`command:followup-rule-decision:${event.id}:ignored`));
    assert.equal(keys.some(k=>k.startsWith('followup-accepted-window:')),false);
  }finally{f.dispose();}
});
