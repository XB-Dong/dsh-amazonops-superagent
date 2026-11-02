/** Owner validation context: real upstream Store + official JSONL read provider; no app/model startup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Store,Engine } from '../../vendor/superagent/src/extension.ts';
import { Effects } from '../../vendor/superagent/src/app/effects.ts';
import { HealthBoard } from '../../vendor/superagent/src/infra/health.ts';
import { settingsPolicy } from '../../vendor/superagent/src/policy.ts';

function inventory(root:string): unknown[] {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
    const path=join(root,entry.name);
    return entry.isDirectory()?inventory(path):[{path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}];
  });
}
async function fixture(compression:'none'|'zstd'='none') {
  const root=mkdtempSync(join(tmpdir(),'amazonops-owner-validation-'));
  mkdirSync(join(root,'superagent'));
  const store=new Store(join(root,'superagent/orchestrator.sqlite'));store.close();
  const context=new Context();
  const fiber=context.plugin(jsonl,{root:join(root,'harness/sessions'),compression});await fiber.await();
  const provider=context.get('sessionPersistence')!;
  const handle=await provider.create({id:'worker-synthetic' as never,version:SESSION_FORMAT_VERSION,createdAt:1,isSeeded:false,delegationDepth:0});
  await handle.append([{type:'session/title',seq:0 as never,time:1,data:{title:'synthetic fixture',messageSeqs:[],source:{kind:'user'}}}]);
  await handle.flush();await handle.close();await fiber.dispose();
  const path=join(root,`harness/sessions/_no-cwd/worker-synthetic/session.v4.jsonl${compression==='zstd'?'.zstd':''}`);
  return {root,path};
}
function validate(root:string) {
  return spawnSync(process.execPath,[resolve('scripts/validate-native-recovery.mjs'),root],{cwd:resolve('.'),encoding:'utf8',windowsHide:true,timeout:10000});
}
/** Genuine native Engine acceptance persists a launch before any DSH Session exists. */
function queuedFixture(change?:(store:Store,engine:Engine,ticketId:string,assignmentId:string)=>void) {
  const root=mkdtempSync(join(tmpdir(),'amazonops-owner-queued-'));mkdirSync(join(root,'superagent'));
  const store=new Store(join(root,'superagent/orchestrator.sqlite'));
  const settings=store.settings();settings.policy.sources.amazonops={allowed:[{id:'cc'}],admission:{}};store.saveSettings(settings);
  const scope={scope:()=>({listened:true as const,observed:false})};const effects=new Effects(store,new HealthBoard());
  const engine=new Engine({repo:store,scope,policy:()=>settingsPolicy(store.settings(),scope),assessor:{request(){}},
    executor:{start(ticket,assignment){effects.enqueue('launch',assignment.id,{ticketId:ticket.id,assignmentId:assignment.id});},deliver(){},stop(){}},
    outbox:{send(){},status(){return undefined;},withdraw(){}}});
  engine.receive({id:'queued-source',source:'amazonops',threads:[{source:'amazonops',id:'queued-thread'}],actor:{source:'amazonops',id:'cc'},
    human:true,addressed:'direct',at:'2026-11-02T00:00:00.000Z',text:'合成排队工单',meta:{}});
  const decision=engine.decide('queued-source',{kind:'accept',title:'合成排队工单',scope:'排队恢复验收',reason:'Explicit synthetic request'});
  const ticket=store.tickets.get(decision.ticketId!)!;assert.equal(ticket.assignments[0].state,'pending');assert.equal(ticket.assignments[0].startedAt,undefined);
  assert.ok(store.db.prepare("SELECT key FROM effect WHERE kind='launch' AND key=?").get(ticket.assignments[0].id));
  change?.(store,engine,ticket.id,ticket.assignments[0].id);store.close();return {root,ticketId:ticket.id};
}
test('native queued ticket with durable launch is recoverable before worker session creation',()=>{
  const f=queuedFixture();const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{ok:true,databases:1,sessions:0,events:0});
  assert.deepEqual(inventory(f.root),before);
});
test('native launch failure before session creation can be restored without a worker artifact',()=>{
  const f=queuedFixture((store,engine,id)=>{engine.report(id,{state:'failed',summary:'Synthetic launch failed before ensureSession'});store.db.exec("DELETE FROM effect WHERE kind='launch'");});
  const before=inventory(f.root);const result=validate(f.root);assert.equal(result.status,0,result.stderr);assert.deepEqual(inventory(f.root),before);
});
test('human stop of a never-started native ticket does not require a nonexistent session',()=>{
  const f=queuedFixture((store,engine,id)=>{engine.stopTicket(id,'Synthetic human cancellation before launch');store.db.exec("DELETE FROM effect WHERE kind='launch'");});
  const before=inventory(f.root);const result=validate(f.root);assert.equal(result.status,0,result.stderr);assert.deepEqual(inventory(f.root),before);
});
test('started native assignment with a missing worker session remains rejected',()=>{
  const f=queuedFixture((_store,engine,id,assignment)=>engine.assignmentStarted(id,assignment));
  const before=inventory(f.root);const result=validate(f.root);assert.equal(result.status,1);
  assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_WORKER_SESSION_REQUIRED'});assert.deepEqual(inventory(f.root),before);
});
test('orphan pending assignment cannot use an unrelated launch to waive session integrity',()=>{
  const f=queuedFixture(store=>store.db.prepare("UPDATE effect SET value=? WHERE kind='launch'").run(JSON.stringify({ticketId:'different-ticket',assignmentId:'different-assignment'})));
  const result=validate(f.root);assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_WORKER_SESSION_REQUIRED'});
});
for(const evidence of ['deliveredAt','idleAt','input-read','input-pending-read','input-delivered','prior-started'] as const)test(`native ${evidence} history still requires its worker artifact`,()=>{
  const f=queuedFixture((store,_engine,id)=>{
    const ticket=store.tickets.get(id)!;
    if(evidence==='prior-started')ticket.assignments.unshift({...ticket.assignments[0],id:'earlier',state:'ended',startedAt:'2026-11-02T00:00:01.000Z'});
    else if(evidence==='input-read'||evidence==='input-pending-read'||evidence==='input-delivered')ticket.inputs.push({id:'delivered-input',kind:'trigger',triggerId:'queued-source',at:ticket.createdAt,
      ...(evidence==='input-delivered'?{deliveredTo:ticket.assignments[0].id}:{readAt:evidence==='input-read'?'2026-11-02T00:00:01.000Z':null})});
    else ticket.assignments[0][evidence]='2026-11-02T00:00:01.000Z';
    store.tickets.save(ticket);
  });
  const result=validate(f.root);assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_WORKER_SESSION_REQUIRED'});
});
test('native recovery validator fully reads official session bodies without modifying owners',async()=>{
  const f=await fixture();const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{ok:true,databases:1,sessions:1,events:1});
  assert.deepEqual(inventory(f.root),before);
});
test('manifest-correct corrupt native SQLite owner is rejected with a static code',async()=>{
  const f=await fixture();writeFileSync(join(f.root,'superagent/orchestrator.sqlite'),'CORRUPT_SYNTHETIC_DATABASE_BODY');
  const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_DATABASE_INVALID'});
  assert.deepEqual(inventory(f.root),before);
});
test('native recovery validates current compressed JSONL through the official provider without writes',async()=>{
  const f=await fixture('zstd');const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{ok:true,databases:1,sessions:1,events:1});
  assert.deepEqual(inventory(f.root),before);
});
test('native recovery rejects corrupt compressed frames before the provider can recover a prefix',async()=>{
  const f=await fixture('zstd');const bytes=readFileSync(f.path);bytes[bytes.length-1]^=0xff;writeFileSync(f.path,bytes);
  const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_SESSION_INVALID'});
  assert.deepEqual(inventory(f.root),before);
});
for(const corruption of ['sequence','header','body','torn-tail'] as const)test(`native recovery rejects ${corruption} corruption before publishing`,async()=>{
  const f=await fixture();const lines=readFileSync(f.path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  if(corruption==='sequence')lines[1].seq=7;
  if(corruption==='header')lines[0].id='wrong-header-identity';
  if(corruption==='body')lines[1].type='unknown-required-fixture-event';
  writeFileSync(f.path,corruption==='torn-tail'?JSON.stringify(lines[0])+'\n{"torn":':lines.map(line=>JSON.stringify(line)).join('\n')+'\n');
  const before=inventory(f.root);const result=validate(f.root);
  assert.equal(result.status,1,result.stdout);assert.equal(result.stdout,'');
  assert.deepEqual(JSON.parse(result.stderr),{ok:false,error:'NATIVE_SESSION_INVALID'});
  assert.deepEqual(inventory(f.root),before);
});
