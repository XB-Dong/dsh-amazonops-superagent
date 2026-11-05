import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { buildProject } from '../../scripts/build.mjs';
import { localPatch } from '../../profiles/local.ts';
import { scrubEnvironment,lineWriter } from '../../scripts/start.mjs';
import { p1Model } from './p1-native-model.ts';
import { fixture,WorkbenchSource } from './review-fixtures.ts';
import { proactiveAutoEnabled,permittedBusinessTrigger,readableBusinessTrigger } from '../../packages/host/followup-native-authority.ts';
import { privacyHooks } from '../../packages/host/privacy.ts';

test('unit: automatic authorization rereads the trusted gate at every tool and preserves read-only history',()=>{
  const f=fixture();try{
    new WorkbenchSource(f.runtime,f.business);
    assert.equal(proactiveAutoEnabled(f.business),false,'an absent trusted gate fails closed');
    let enabled=true;const source=new WorkbenchSource(f.runtime,f.business,{proactiveAutoEnabled:()=>enabled});
    const forecast=f.business.command('main','forecast',{requestId:'gate-forecast',store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily:5,manualReason:'Synthetic gate fixture'});
    const inventory=f.business.command('main','inventory',{forecastId:forecast.id,physicalSku:'A',asOf:'2026-11-05',available:12,reserved:0,inbound:[],leadDays:{purchase:1,transport:2,receiving:1},safetyDays:2,horizon:7,demandFactors:[]});
    const human=f.business.store.source('main','Synthetic gate authority');
    source.followups.domain.configureRule('main',{requestId:'gate-auto',mode:'auto',inventoryIds:[inventory.id]},human.id);
    source.followups.domain.scan('main');const event=source.followups.domain.pending('main')[0];
    const trigger:any={id:`event-${event.id}`,source:'amazonops',threads:[{source:'amazonops',id:'gate-test'}],actor:{source:'amazonops',id:'inventory-risk'},
      human:false,text:'Synthetic gate candidate',at:event.createdAt,meta:{scope:'main',eventClass:'risk_candidate',eventId:event.id}};
    f.business.store.create('main','source',{text:trigger.text,origin:'tool',sources:event.sources},trigger.id);f.triggers.set(trigger.id,trigger);
    const ticket:any={id:'gate-ticket',origin:{triggerId:trigger.id,triggerIds:[trigger.id]},inputs:[],assignments:[],updatedAt:event.createdAt};f.tickets.set(ticket.id,ticket);
    const agent=f.agent(ticket),hooks=privacyHooks(f.business,()=>f.runtime,()=>source,agent.tools);
    agent.tools.authorize(agent.value,ticket);hooks.authorizeTool(agent.value,undefined,'orchestrator_eval_decide',{trigger_id:trigger.id});
    enabled=false;
    assert.equal(permittedBusinessTrigger(f.business,trigger),false);
    assert.equal(readableBusinessTrigger(f.business,trigger),true,'disabling automation does not erase historical provenance');
    assert.throws(()=>agent.tools.authorize(agent.value,ticket),/FOLLOWUP_EVENT_STALE/);
    assert.throws(()=>hooks.authorizeTool(agent.value,undefined,'orchestrator_eval_decide',{trigger_id:trigger.id}),/SOURCE_FORBIDDEN/);
    assert.throws(()=>hooks.authorizeTool(agent.value,ticket,'cc_prepare_task',{title:'Must not write'}),/FOLLOWUP_EVENT_STALE/);
    assert.equal(f.business.snapshot('main').tasks.length,0);
  }finally{f.dispose();}
});

test('actual native auto gate blocks persisted candidates and restored workers while preserving rule intent', {timeout:120000},async()=>{
  const root=resolve('.'),home=mkdtempSync(join(tmpdir(),'amazonops-p1-auto-gate-')),evidence=join(home,'evidence');mkdirSync(evidence);
  let release!:()=>void;const held=new Promise<void>(done=>{release=done;});
  const model=await p1Model(evidence,{beforeTool:async(call,role)=>{if(role==='worker'&&call.name==='cc_prepare_task')await held;}});
  let child:ChildProcess|undefined,logs='',cookie='';
  const password='synthetic-auto-gate-password',key='synthetic-auto-gate-key';
  const socket=createServer();await new Promise<void>(done=>socket.listen(0,'127.0.0.1',done));const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`;
  await buildProject({root,hostEntry:join(root,'tests/integration/p1-native-fixture-host.ts')});
  const profile=localPatch({root,home,password,port,live:true,modelAccount:'test'});
  const host=profile.flatMap((r:any)=>r.insert??[]).find((r:any)=>r.id==='amazonops-host');host.config.evidence=evidence;host.config.proactiveAutoEnabled=false;
  (profile.find((r:any)=>r.id==='llm-deepseek') as any).config.baseURL=model.url;
  const patch=join(home,'profile.json');
  async function api(path:string,body?:unknown,expected=200){
    const response=await fetch(`${origin}/amazonops/api/${path}`,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
    const value=await response.json() as any;if(path==='login'&&response.ok)cookie=response.headers.get('set-cookie')!.split(';')[0];
    assert.equal(response.status,expected,`${path}: ${JSON.stringify(value)}`);return value;
  }
  async function until<T>(name:string,read:()=>Promise<T|undefined>):Promise<T>{
    const end=Date.now()+30000;let last='';while(Date.now()<end){
      if(child?.exitCode!==null&&child?.exitCode!==undefined)throw new Error(`Host exited ${child.exitCode}: ${logs.slice(-4000)}`);
      try{const result=await read();if(result!==undefined)return result;}catch(error){last=String(error);}
      await new Promise(done=>setTimeout(done,100));
    }throw new Error(`${name}: ${last}; evidence=${home}; calls=${JSON.stringify(model.requests)}; ${logs.slice(-3000)}`);
  }
  async function boot(enabled:boolean){
    host.config.proactiveAutoEnabled=enabled;writeFileSync(patch,JSON.stringify(profile));cookie='';
    const environment=scrubEnvironment(process.env,home,key);environment.AMAZONOPS_NETWORK_EVIDENCE=join(evidence,'network.jsonl');
    child=spawn(process.execPath,['--require',join(root,'tests/integration/native-e2e-network.cjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open'],
      {cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    const writer=lineWriter(chunk=>{logs+=chunk;writeFileSync(join(evidence,'host.log'),logs);},[password,key]);child.stdout!.on('data',c=>writer.push(String(c)));child.stderr!.on('data',c=>writer.push(String(c)));
    await until('ready',async()=>{await api('login',{password});return (await api('state')).ready?true:undefined;});
  }
  async function shutdown(){const current=child;child=undefined;if(!current||current.exitCode!==null)return;
    if(current.connected)current.send('p1-stop');else current.kill();await new Promise<void>(done=>{current.once('exit',()=>done());setTimeout(()=>{current.kill('SIGKILL');done();},5000).unref();});}
  const quiet=()=>new Promise(done=>setTimeout(done,2400));
  try{
    await boot(false);const inventory=await api('seed',{});
    await api('stage-rule',{requestId:'persisted-auto-intent',mode:'auto',inventoryIds:[inventory.id]});
    await quiet();let state=await api('state');
    assert.equal(state.followups.rule.mode,'auto','stored user intent is preserved');
    assert.equal(state.settings.eval.mode,'off','trusted false gate overrides persisted auto at runtime');
    assert.equal(state.pending.length,1,'pending auto candidate is retained without being represented as observe');
    assert.equal(state.pending[0].ruleMode,'auto');assert.equal(state.triggers.length,0);assert.equal(state.tickets.length,0);assert.equal(state.tasks.length,0);
    assert.equal(state.followups.autoAvailable,false,'request options cannot claim runtime availability');
    await shutdown();await boot(false);await quiet();state=await api('state');
    assert.equal(state.settings.eval.mode,'off');assert.equal(state.followups.rule.mode,'auto');assert.equal(state.tickets.length,0);assert.equal(state.tasks.length,0);
    await shutdown();await boot(true);
    state=await until('actual accepted worker before internal draft tool',async()=>{const s=await api('state');return s.tickets.length===1&&model.requests.some(r=>r.role==='worker'&&r.tool==='cc_prepare_task')?s:undefined;});
    assert.equal(state.settings.eval.mode,'auto');assert.equal(state.tasks.length,0);assert.equal(state.tickets[0].ended,undefined);
    const workerRequests=model.requests.filter(r=>r.role==='worker').length;
    await shutdown();release();await boot(false);await quiet();state=await api('state');
    assert.equal(state.settings.eval.mode,'off');assert.equal(state.followups.rule.mode,'auto');assert.equal(state.tasks.length,0,'restored auto worker cannot continue into internal draft execution');
    assert.equal(model.requests.filter(r=>r.role==='worker').length,workerRequests,'restored auto worker cannot resume model work');
    assert.ok(state.tickets[0].ended,'trusted pump revokes the restored auto assignment');
    const blocked=await api('rule',{requestId:'request-cannot-enable',mode:'auto',inventoryIds:[inventory.id]},400);
    assert.match(JSON.stringify(blocked),/AUTO_NOT_VALIDATED/);
    const events=readFileSync(join(evidence,'session-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const draftCalls=events.filter(e=>e.event.type==='tool/call'&&e.event.data.name==='cc_prepare_task');
    assert.equal(draftCalls.length,0,'held draft call must never reach the native tool executor after restart');
    writeFileSync(join(evidence,'gate-result.json'),JSON.stringify({passed:true,actualNative:true,storedMode:'auto',effectiveMode:state.settings.eval.mode,pendingAutoRetained:true,restoredWorkerBlocked:true,externalModelCalls:0}));
  }finally{release();await shutdown();await new Promise<void>(done=>model.server.close(()=>done()));}
});
