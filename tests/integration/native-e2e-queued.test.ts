/** Context map / self-review: official DSH, Source/Engine/slots=1, native checkpoint,
 * CLI owner validation, fresh-home launch. No product changes or replacement loop.
 * All business/model inputs are synthetic and raw evidence stays outside Git. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn,spawnSync,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { buildProject } from '../../scripts/build.mjs';
import { scrubEnvironment,lineWriter } from '../../scripts/start.mjs';
import { localPatch } from '../../profiles/local.ts';
import { fakeModel,resultText } from './native-e2e-model.ts';

test('real native queued worker without a session survives checkpoint, CLI restore and eventual launch',{timeout:100000},async t=>{
  const root=resolve('.');const home=mkdtempSync(join(tmpdir(),'amazonops-native-queued-'));
  const evidence=join(home,'evidence');mkdirSync(evidence);const model=await fakeModel(evidence);model.control.holdWorkers=true;
  await buildProject({root});const probe=join(root,'lib/native-e2e-queue-probe.js');
  await build({entryPoints:[join(root,'tests/integration/native-e2e-queue-probe.ts')],outfile:probe,bundle:true,packages:'external',platform:'node',format:'esm',target:'node24'});
  const socket=createServer();await new Promise<void>(done=>socket.listen(0,'127.0.0.1',done));const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`;const password='synthetic-queued-fixture-password';const key='synthetic-queued-fixture-key';
  const network=join(evidence,'network.jsonl');writeFileSync(network,'');const patch=join(home,'profile.json');
  let child:ChildProcess|undefined,cookie='',logs='';
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch(`${origin}${path.startsWith('/')?path:'/amazonops/api/'+path}`,{method:body===undefined?'GET':'POST',headers:{origin,cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    return {response,value:await response.json() as any};
  };
  const until=async(name:string,predicate:()=>Promise<any>)=>{
    let last='';const deadline=Date.now()+40000;
    while(Date.now()<deadline){if(child&&child.exitCode!==null)throw new Error('QUEUED_HOST_EXITED');try{const value=await predicate();if(value)return value;}catch(error){last=String(error);}await new Promise(done=>setTimeout(done,100));}
    throw new Error(`${name}: ${last}; evidence=${home}; ${logs.slice(-1500)}`);
  };
  const state=()=>JSON.parse(readFileSync(join(evidence,'native-state.json'),'utf8'));
  async function boot(runHome:string){
    const profile=localPatch({root,home:runHome,password,port,live:true,modelAccount:'test'});const provider=(profile.find((row:any)=>row.id==='llm-deepseek') as any).config;
    writeFileSync(patch,JSON.stringify([{insert:[{id:'queued-observer',name:probe.replaceAll('\\','/'),config:{evidence}}]},...profile,{id:'llm-deepseek',config:{...provider,baseURL:model.url}}]));
    const env=scrubEnvironment(process.env,runHome,key);env.AMAZONOPS_NETWORK_EVIDENCE=network;
    child=spawn(process.execPath,['--require',join(root,'tests/integration/native-e2e-network.cjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    const writer=lineWriter((text:string)=>{logs+=text;writeFileSync(join(evidence,'host.log'),logs);},[password,key]);child.stdout!.on('data',chunk=>writer.push(String(chunk)));child.stderr!.on('data',chunk=>writer.push(String(chunk)));
    await until('queued host login',async()=>{const result=await api('login',{password});if(result.response.ok){cookie=result.response.headers.get('set-cookie')!.split(';')[0];return true;}});
    await until('Source and one worker slot',async()=>(await api('status')).value.live&&state().settings.executor.maxWorkers===1);
  }
  async function shutdown(){const current=child;child=undefined;if(!current||current.exitCode!==null)return;if(current.connected)current.send('native-e2e-graceful-stop');else current.kill();await new Promise<void>(done=>{current.once('exit',()=>done());setTimeout(()=>{current.kill('SIGKILL');done();},5000).unref();});}
  try{
    await boot(home);
    const first=await api('messages',{requestId:'queue-first',text:'创建第一份合成库存检查草稿。'});assert.equal(first.response.status,200);
    await until('first worker holds real local model stream',async()=>model.control.activeWorkers===1);
    const second=await api('messages',{requestId:'queue-second',text:'创建第二份独立合成库存检查草稿。'});assert.equal(second.response.status,200);
    const queued=await until('second ticket queued without startup',async()=>state().tickets.find((ticket:any)=>ticket.origin.triggerId===second.value.messageId));
    assert.equal(queued.assignments.at(-1).state,'pending');assert.equal(queued.assignments.at(-1).startedAt,undefined);
    assert.equal(model.control.activeWorkers,1);
    const missing=await api(`/native-e2e/inspection?sessionId=worker-${queued.id}`);assert.equal(missing.response.status,404,'A queued worker has no invented native Session');
    const liveDb=new DatabaseSync(join(home,'data/superagent/orchestrator.sqlite'),{readOnly:true});
    try{const launch=liveDb.prepare("SELECT value FROM effect WHERE kind='launch' AND key=?").get(queued.assignments.at(-1).id);assert.ok(launch);assert.deepEqual(JSON.parse(String(launch.value)),{ticketId:queued.id,assignmentId:queued.assignments.at(-1).id});}finally{liveDb.close();}
    const captured=await api('actions/backup',{});assert.equal(captured.response.status,200,JSON.stringify(captured.value));
    const point=join(home,'data/backups',captured.value.id);const manifest=JSON.parse(readFileSync(join(point,'manifest.json'),'utf8'));
    assert.ok(!manifest.files.some((file:any)=>file.path.includes(`/worker-${queued.id}/`)),'Checkpoint must preserve the legitimate absence of the queued session');
    const db=new DatabaseSync(`${pathToFileURL(join(point,'superagent/orchestrator.sqlite')).href}?immutable=1`,{readOnly:true});
    try{const ticket=JSON.parse(String(db.prepare('SELECT value FROM ticket WHERE id=?').get(queued.id)?.value));assert.equal(ticket.assignments.at(-1).state,'pending');assert.equal(ticket.assignments.at(-1).startedAt,undefined);}finally{db.close();}
    await shutdown();
    const recovered=mkdtempSync(join(tmpdir(),'amazonops-native-queue-recovered-'));
    const restore=spawnSync(process.execPath,['--experimental-transform-types',join(root,'scripts/recovery.ts'),'--backup',point,'--current',join(home,'data'),'--destination',join(recovered,'data')],{cwd:root,env:scrubEnvironment(process.env,recovered),windowsHide:true,encoding:'utf8',timeout:30000});
    assert.equal(restore.status,0,restore.stderr);
    model.control.holdWorkers=false;await boot(recovered);
    const delivered=await until('both recovered workers launch and report',async()=>{
      const work=(await api('work')).value;
      return work.tickets.length===2&&work.tickets.every((ticket:any)=>ticket.latestReport?.status==='ready')&&work.messages.filter((message:any)=>message.text===resultText).length===2&&work;
    });
    assert.ok(delivered.tickets.some((ticket:any)=>ticket.id===queued.id));
    const snapshot=(await api('snapshot')).value;assert.equal(snapshot.tasks.length,2);assert.ok(snapshot.tasks.every((task:any)=>task.status==='draft'));
    assert.deepEqual(snapshot.tasks.map((task:any)=>task.sources[0]).sort(),[first.value.messageId,second.value.messageId].sort());
    const session=await until('queued native session persisted after restore',async()=>{const result=await api(`/native-e2e/inspection?sessionId=worker-${queued.id}`);return result.response.ok&&result.value.events.some((event:any)=>event.type==='turn/end')&&result.value;});
    assert.ok(session.events.some((event:any)=>event.type==='tool/call'&&event.data.name==='cc_prepare_task'));
    assert.ok(session.events.some((event:any)=>event.type==='tool/call'&&event.data.name==='orchestrator_report'));
    assert.equal(session.events.findLast((event:any)=>event.type==='turn/end').data.reason.kind,'completed');
    assert.ok(state().tickets.find((ticket:any)=>ticket.id===queued.id).assignments.some((assignment:any)=>assignment.startedAt));
    const status=await until('all resumed requests durably settled',async()=>{const value=(await api('status')).value;return value.budget.used.calls===model.requests.length&&value;});
    assert.ok(readFileSync(network,'utf8').trim().split('\n').map(line=>JSON.parse(line)).every(row=>row.allowed));
    writeFileSync(join(evidence,'queued-acceptance.json'),JSON.stringify({queuedTicket:queued,checkpoint:captured.value,restore:JSON.parse(restore.stdout),delivered,taskIds:snapshot.tasks.map((task:any)=>task.id),modelRequests:model.requests.length,budget:status.budget.used,queuedWorkerEvents:session.events},null,2));
    t.diagnostic(`Queued native recovery evidence: ${home}; queued session absent before checkpoint and completed after restored launch; external attempts=0`);
  }finally{await shutdown();model.server.closeAllConnections();await new Promise<void>(done=>model.server.close(()=>done()));}
});
