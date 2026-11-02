/** Context map / self-review (f24e02c, application v0.2):
 * Business task-success jobs create the L0 Skill; host AgentTools registers the actual
 * cc-approved provider and confirmed-memory context; official DSH skill tool loads it.
 * Native test fixtures only, isolated private home, all model traffic loopback fenced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { buildProject } from '../../scripts/build.mjs';
import { scrubEnvironment,lineWriter } from '../../scripts/start.mjs';
import { localPatch } from '../../profiles/local.ts';
import { Business,type Task } from '../../packages/business/index.ts';
import { skillModel } from './skills-provider-model.ts';

test('real approved Skill Provider and confirmed memory reach native worker and revoke before further use',{timeout:90000},async t=>{
  const root=resolve('.');const home=mkdtempSync(join(tmpdir(),'amazonops-native-skills-'));
  const evidence=join(home,'evidence');mkdirSync(evidence);
  const data=join(home,'data');const business=new Business(data);
  const memory=business.command('main','memory',{requestId:'fixture-memory',key:'库存准备提前量',value:'固定提前6小时核验'}) as any;
  let task=business.command('main','task',{requestId:'fixture-success-task',title:'已人工确认成功的库存核验',timeZone:'Asia/Shanghai',checklist:['核对当前站点库存','逐项确认现有报表日期']}) as Task;
  task=business.command('main','task-update',{id:task.id,revision:task.revision,status:'done',checked:[true,true],confirmedSuccess:true}) as Task;
  business.tick('main');const skill=business.learning.activeSkills('main')[0];
  assert.equal(skill.status,'active');assert.equal(skill.risk,'L0');assert.ok(skill.sources.includes(task.id));business.close();
  const model=await skillModel(evidence);
  await buildProject({root});const probe=join(root,'lib/skills-provider-probe.js');
  await build({entryPoints:[join(root,'tests/native/skills-provider-probe.ts')],outfile:probe,bundle:true,packages:'external',platform:'node',format:'esm',target:'node24'});
  const socket=createServer();await new Promise<void>(done=>socket.listen(0,'127.0.0.1',done));const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`;const password='synthetic-skills-fixture-password';const key='synthetic-skills-fixture-key';
  const profile=localPatch({root,home,password,port,live:true,modelAccount:'test'});
  const provider=(profile.find((row:any)=>row.id==='llm-deepseek') as any).config;
  const patch=join(home,'profile.json');writeFileSync(patch,JSON.stringify([{insert:[{id:'skills-observer',name:probe.replaceAll('\\','/'),config:{evidence}}]},...profile,{id:'llm-deepseek',config:{...provider,baseURL:model.url}}]));
  const network=join(evidence,'network.jsonl');writeFileSync(network,'');const env=scrubEnvironment(process.env,home,key);env.AMAZONOPS_NETWORK_EVIDENCE=network;
  const child=spawn(process.execPath,['--require',join(root,'tests/integration/native-e2e-network.cjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let logs='',cookie='';const writer=lineWriter((chunk:string)=>{logs+=chunk;writeFileSync(join(evidence,'host.log'),logs);},[password,key]);child.stdout!.on('data',chunk=>writer.push(String(chunk)));child.stderr!.on('data',chunk=>writer.push(String(chunk)));
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch(`${origin}${path.startsWith('/')?path:'/amazonops/api/'+path}`,{method:body===undefined?'GET':'POST',headers:{origin,cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
    return {response,value:await response.json() as any};
  };
  const until=async(name:string,predicate:()=>Promise<any>)=>{
    const deadline=Date.now()+30000;let last='';while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('NATIVE_HOST_EXITED');try{const value=await predicate();if(value)return value;}catch(error){last=String(error);}await new Promise(done=>setTimeout(done,75));}
    throw new Error(`${name}: ${last}; evidence=${home}; ${logs.slice(-1500)}`);
  };
  const inspect=async(id:string)=>(await api(`/native-e2e/inspection?sessionId=${encodeURIComponent(id)}`)).value;
  try{
    await until('login',async()=>{const result=await api('login',{password});if(!result.response.ok)return;cookie=result.response.headers.get('set-cookie')!.split(';')[0];return true;});
    await until('Source ready',async()=>(await api('status')).value.live);
    const submitted=await api('messages',{requestId:'provider-use-1',text:'请按当前可用库存核验经验创建待确认草稿，并保留已确认提前量。'});assert.equal(submitted.response.status,200);
    const draft=await until('actual skill callback and business draft',async()=>{
      const snapshot=(await api('snapshot')).value;
      return model.control.held===1&&snapshot.tasks.find((row:any)=>row.id!==task.id);
    });
    assert.equal(draft.status,'draft');assert.deepEqual(draft.checklist,skill.steps);assert.deepEqual(draft.sources,[submitted.value.messageId]);
    const work=(await api('work')).value;const ticket=work.tickets[0];const workerId=`worker-${ticket.id}`;
    const session=await inspect(workerId);
    const call=session.events.find((event:any)=>event.type==='tool/call'&&event.data.name==='skill');assert.ok(call,'Official skill tool must execute');
    assert.deepEqual(JSON.parse(call.data.arguments),{name:skill.name});
    const result=session.events.find((event:any)=>event.type==='tool/result'&&event.data.message.toolCallId===call.data.callId);assert.ok(result);assert.equal(result.data.message.isError,false);
    const rendered=result.data.message.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join('\n');assert.ok(rendered.includes('cc-approved'));assert.ok(rendered.includes('<skill_content'));assert.ok(rendered.includes(skill.name));assert.ok(rendered.includes(skill.content),'Official skill callback must contain the full exact approved body');
    for(const step of skill.steps)assert.ok(rendered.includes(step));
    assert.ok(!session.events.some((event:any)=>event.type==='tool/call'&&event.data.name==='cc_draft_checklist'),'Provider loading cannot be substituted by a business draft tool');
    const first=model.requests.find(row=>row.role==='worker');const body=JSON.stringify(first.body);assert.ok(body.includes(memory.text));assert.ok(body.includes(memory.id));assert.ok(body.includes(skill.name));
    const loaded=model.requests.find(row=>row.role==='worker'&&JSON.stringify(row.body).includes(skill.content.split('\n')[0]));assert.ok(loaded,'A subsequent native request must include the loaded provider body, not just skill-tool guidance');
    const db=new DatabaseSync(join(data,'business.sqlite'),{readOnly:true});
    try{const binding=JSON.parse(String(db.prepare('SELECT payload FROM entities WHERE scope=? AND id=?').get('main',`native-binding:${workerId}`)?.payload));assert.ok(binding.sources.includes(memory.id));assert.ok(binding.skills.some((row:any)=>row.id===skill.id&&row.hash===skill.hash));}finally{db.close();}
    const before=JSON.parse(readFileSync(join(evidence,'native-state.json'),'utf8'));
    const revoked=await api('actions/skill-revoke',{id:skill.id});assert.equal(revoked.response.status,200);
    await until('revoked skill checkpoints and aborts worker',async()=>{const state=JSON.parse(readFileSync(join(evidence,'native-state.json'),'utf8'));return state.masterId!==before.masterId&&model.control.aborted===1&&(await api('snapshot')).response.ok;});
    const count=model.requests.length;const stale=await api(`/skills-fixture/stale?sessionId=${workerId}`);assert.equal(stale.value.exists,true,'Exercise the real retained worker, not only a missing-agent rejection');assert.equal(stale.value.denied,true);
    await new Promise(done=>setTimeout(done,500));assert.equal(model.requests.length,count,'Revoked worker must not issue another provider request');assert.equal((await api('snapshot')).value.tasks.length,2,'Revoked worker must not write another business task');
    model.control.newWorker=true;model.control.holdAfterDraft=false;
    const next=await api('messages',{requestId:'provider-use-2',text:'核验当前可用经验清单，已撤销经验不可复用。'});assert.equal(next.response.status,200);
    const fresh=await until('fresh worker without revoked provider entry',async()=>model.requests.slice(count).find(row=>row.role==='worker'));
    const freshBody=JSON.stringify(fresh.body);assert.ok(freshBody.includes(memory.text));assert.ok(!freshBody.includes(skill.name));assert.ok(!freshBody.includes(skill.content));
    assert.ok(readFileSync(network,'utf8').trim().split('\n').map(line=>JSON.parse(line)).every(row=>row.allowed));
    writeFileSync(join(evidence,'acceptance.json'),JSON.stringify({memoryId:memory.id,skillId:skill.id,skillName:skill.name,sourceTaskId:task.id,draftId:draft.id,workerId,skillCall:call,skillResult:result,stale:stale.value,modelRequests:model.requests.length},null,2));
    t.diagnostic(`Native approved skill/memory evidence: ${home}; real skill callback=1; external attempts=0`);
  }finally{
    if(child.connected)child.send('native-e2e-graceful-stop');else child.kill();await new Promise<void>(done=>{if(child.exitCode!==null)done();else{child.once('exit',()=>done());setTimeout(()=>{child.kill('SIGKILL');done();},5000).unref();}});
    model.server.closeAllConnections();await new Promise<void>(done=>model.server.close(()=>done()));
    if(!existsSync(join(evidence,'acceptance.json')))t.diagnostic(`Failed skill fixture evidence: ${home}`);
  }
});
