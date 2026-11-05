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

test('actual native finite watch continues on business change, hands decision to human and delivers final result; observe never launches worker', {timeout:180000},async()=>{
  const root=resolve('.'),home=mkdtempSync(join(tmpdir(),'amazonops-p1-native-')),evidence=join(home,'evidence');mkdirSync(evidence);
  const model=await p1Model(evidence);let child:ChildProcess|undefined,logs='',cookie='';
  const password='synthetic-native-followup-password',key='synthetic-native-followup-key';
  const socket=createServer();await new Promise<void>(done=>socket.listen(0,'127.0.0.1',done));const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`;
  await buildProject({root,hostEntry:join(root,'tests/integration/p1-native-fixture-host.ts')});
  const profile=localPatch({root,home,password,port,live:true,modelAccount:'test'});
  const entries=profile.flatMap((r:any)=>r.insert??[]),host=entries.find((r:any)=>r.id==='amazonops-host');host.config.evidence=evidence;
  const provider=(profile.find((r:any)=>r.id==='llm-deepseek') as any).config;provider.baseURL=model.url;
  const patch=join(home,'profile.json');writeFileSync(patch,JSON.stringify(profile));
  async function api(path:string,body?:unknown){
    const response=await fetch(`${origin}/amazonops/api/${path}`,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
    const value=await response.json() as any;if(path==='login'&&response.ok)cookie=response.headers.get('set-cookie')!.split(';')[0];
    assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(value)}`);return value;
  }
  async function until<T>(name:string,read:()=>Promise<T|undefined>,ms=45000):Promise<T>{
    const end=Date.now()+ms;let last='';while(Date.now()<end){
      if(child?.exitCode!==null&&child?.exitCode!==undefined)throw new Error(`Host exited ${child.exitCode}: ${logs.slice(-4000)}`);
      try{const result=await read();if(result!==undefined)return result;}catch(error){last=String(error);}
      await new Promise(done=>setTimeout(done,100));
    }throw new Error(`${name} timeout: ${last}; evidence=${home}; calls=${JSON.stringify(model.requests)}; ${logs.slice(-3000)}`);
  }
  async function state(){return api('state');}
  async function boot(){
    const environment=scrubEnvironment(process.env,home,key);environment.AMAZONOPS_NETWORK_EVIDENCE=join(evidence,'network.jsonl');
    child=spawn(process.execPath,['--require',join(root,'tests/integration/native-e2e-network.cjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open'],
      {cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    const writer=lineWriter(chunk=>{logs+=chunk;writeFileSync(join(evidence,'host.log'),logs);},[password,key]);child.stdout!.on('data',c=>writer.push(String(c)));child.stderr!.on('data',c=>writer.push(String(c)));
    await until('ready',async()=>{await api('login',{password});return (await state()).ready?true:undefined;});
  }
  async function shutdown(){const process=child;child=undefined;if(!process||process.exitCode!==null)return;
    if(process.connected)process.send('p1-stop');else process.kill();await new Promise<void>(done=>{process.once('exit',()=>done());setTimeout(()=>{process.kill('SIGKILL');done();},5000).unref();});}
  try{
    await boot();const inventory=await api('seed',{});
    const input={inventoryId:inventory.id,requestId:'native-watch',expiresAt:new Date(Date.now()+86400000).toISOString()};
    const watch=await api('watch',input);assert.equal((await api('watch',input)).id,watch.id);
    let current=await until('real waiting and first answer outbox',async()=>{
      const s=await state();const ticket=s.tickets.find((t:any)=>t.origin.triggerId===watch.sourceId);
      return ticket&&!ticket.ended&&ticket.assignments.at(-1)?.report?.state==='waiting'&&s.outbox.some((m:any)=>m.text==='已开始有限期库存跟进。'&&m.status==='sent')?s:undefined;
    });
    assert.deepEqual(current.owners,['Engine','Store','DshExecutor']);assert.equal(current.tickets.length,1);
    const ticketId=current.tickets[0].id;
    await api('change',{requestId:'native-change',quantity:8});
    current=await until('actual attention and native delivery',async()=>{const s=await state();return s.tickets[0].attention&&s.outbox.some((m:any)=>m.text==='请选择合成方案A或B。'&&m.status==='sent')?s:undefined;});
    const eventTriggers=current.triggers.filter((t:any)=>t.meta.eventClass==='watch_update');assert.equal(eventTriggers.length,1);
    assert.equal(current.decisions.filter((d:any)=>d.kind==='accept').length,1,'machine continuation must not accept a new ticket');
    const attention=current.tickets[0].attention;
    await api('action',{ticketId,requestId:'answer-native',action:'answer',expectedUpdatedAt:current.tickets[0].updatedAt,attentionId:attention.id,text:'选择合成方案A，保存内部草稿'});
    current=await until('draft and genuine human answer',async()=>{const s=await state();return s.tasks.length===1&&s.outbox.some((m:any)=>m.text==='已保存合成方案A复核草稿，继续跟进。'&&m.status==='sent')?s:undefined;});
    assert.equal(current.tasks[0].status,'draft');assert.equal(current.tickets[0].ended,undefined);
    const requestsBefore=model.requests.length;await new Promise(done=>setTimeout(done,500));assert.equal((await state()).tasks.length,1);
    assert.equal(model.requests.length,requestsBefore,'unchanged business state stays quiet');
    await api('action',{ticketId,requestId:'complete-native',action:'supplement',expectedUpdatedAt:current.tickets[0].updatedAt,text:'现在完成跟进，保留内部草稿等待确认。'});
    current=await until('completed native ticket and final result',async()=>{const s=await state();return s.tickets[0].ended?.outcome==='completed'&&s.outbox.some((m:any)=>m.text==='库存跟进已按cc要求完成，内部草稿等待确认。'&&m.status==='sent')?s:undefined;});
    assert.equal(current.tasks.length,1);
    await api('rule',{requestId:'observe-native',mode:'observe',inventoryIds:[inventory.id]});
    current=await until('actual observe assessment',async()=>{const s=await state();return s.followups.assessments.some((a:any)=>a.decision==='would_accept')?s:undefined;});
    assert.equal(current.tickets.length,1,'observe cannot launch another worker');assert.equal(current.tasks.length,1);
    await api('rule',{requestId:'auto-native',mode:'auto',inventoryIds:[inventory.id]});
    current=await until('single native auto worker and result',async()=>{const s=await state();return s.tickets.length===2&&s.tasks.length===2&&s.outbox.some((m:any)=>m.text==='规则草稿已准备，等待确认。'&&m.status==='sent')?s:undefined;});
    await shutdown();await boot();const restarted=await state();
    assert.equal(restarted.tasks.length,2);assert.equal(restarted.tickets.length,2);
    const modelEvidence=readFileSync(join(evidence,'model-requests.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
    const assessmentRequest=modelEvidence.find(r=>r.tool==='orchestrator_eval');
    assert.match(JSON.stringify(assessmentRequest.body.messages),/inventory-risk-review/,'real model sees actual current rule ID in DSH runtime context');
    const events=readFileSync(join(evidence,'session-events.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
    const calls=events.filter(e=>e.event.type==='tool/call');const callbacks=events.filter(e=>e.event.type==='tool/result');
    for(const name of ['orchestrator_route','cc_read_watch','cc_prepare_task','orchestrator_report','orchestrator_reply','orchestrator_eval','orchestrator_eval_decide'])
      assert.ok(callbacks.some(r=>r.event.data.message.isError!==true&&calls.some(c=>c.sessionId===r.sessionId&&c.event.data.callId===r.event.data.message.toolCallId&&c.event.data.name===name)),`successful native callback missing: ${name}`);
    writeFileSync(join(evidence,'final-state.json'),JSON.stringify(restarted,null,2));
    writeFileSync(join(evidence,'result.json'),JSON.stringify({passed:true,tickets:2,tasks:2,requests:model.requests.length,actualNative:true,externalModelCalls:0}));
  }finally{await shutdown();await new Promise<void>(done=>model.server.close(()=>done()));}
});
