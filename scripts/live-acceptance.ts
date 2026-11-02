/** Explicit paid acceptance. Ordinary test runner never discovers this script. */
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { localPatch } from '../profiles/local.ts';
import { scrubEnvironment,lineWriter } from './start.mjs';
import assert from 'node:assert/strict';

const apiKey=process.env.AMAZONOPS_API_KEY;
if(!apiKey)throw new Error('AMAZONOPS_API_KEY_REQUIRED');
const root=resolve('.');
const home=mkdtempSync(join(tmpdir(),'amazonops-live-'));
const evidence=join(home,'evidence');mkdirSync(evidence);
const password=randomBytes(24).toString('base64url');
const listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));
const port=(listener.address() as {port:number}).port;
await new Promise<void>(done=>listener.close(()=>done()));
const origin=`http://127.0.0.1:${port}`;
const probe=join(root,'lib/live-observer.js');
await build({entryPoints:[join(root,'tests/integration/native-e2e-probe.ts')],outfile:probe,bundle:true,packages:'external',platform:'node',format:'esm',target:'node24'});
const profile=join(home,'private-profile.json');
writeFileSync(profile,JSON.stringify([{insert:[{id:'acceptance-observer',name:probe.replaceAll('\\','/'),config:{evidence}}]},
  ...localPatch({root,home,password,port,live:true,modelAccount:'test'})]),{mode:0o600});
let cookie='';let logs='';let child:ChildProcess|undefined;
let failure:unknown;
const report:{home:string;origin:string;scenarios:unknown[];usage?:unknown;requests?:unknown;error?:string}={home,origin,scenarios:[]};
async function api(path:string,body?:unknown){
  const response=await fetch(`${origin}/amazonops/api/${path}`,{method:body===undefined?'GET':'POST',
    headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
  const value=await response.json() as any;
  return {response,value};
}
async function until<T>(name:string,check:()=>Promise<T|undefined>,timeout=180000):Promise<T>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(child?.exitCode!==null&&child?.exitCode!==undefined)throw new Error('NATIVE_HOST_EXITED');
    try{const value=await check();if(value!==undefined)return value;}
    catch(error){if(error instanceof Error&&/FAILED|FORBIDDEN/.test(error.message))throw error;}
    await new Promise(done=>setTimeout(done,500));
  }
  throw new Error(`${name}_TIMEOUT`);
}
try{
  child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',profile,'--no-open'],
    {cwd:root,env:scrubEnvironment(process.env,home,apiKey),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const writer=lineWriter((chunk:string)=>{logs+=chunk;writeFileSync(join(evidence,'host.log'),logs);},[apiKey,password]);
  child.stdout!.on('data',chunk=>writer.push(String(chunk)));child.stderr!.on('data',chunk=>writer.push(String(chunk)));
  await until('LOGIN',async()=>{const {response}=await api('login',{password});if(!response.ok)return;cookie=response.headers.get('set-cookie')!.split(';')[0];return true;},20000);
  await until('SOURCE',async()=>(await api('status')).value.live?true:undefined,20000);
  for(const [index,text] of [
    '这是新项目的合成验收。请创建一份标题为“P0 真实模型库存检查”的待确认任务草稿，时区Asia/Shanghai，检查项为“核对合成库存报表”和“等待cc确认后执行”。不要执行外部操作。完成后告诉我草稿已保存。',
    '这是第二项合成验收。请查找刚才的“P0 真实模型库存检查”任务，完整读取检查项，然后复制成新草稿，标题改为“P0 真实模型库存复核”。保留原任务，向我说明复制结果。',
  ].entries()){
    const submitted=await api('messages',{text,requestId:`live-acceptance-${index+1}`});
    assert.equal(submitted.response.status,200);
    const expected=index===0?'P0 真实模型库存检查':'P0 真实模型库存复核';
    const result=await until('SCENARIO',async()=>{
      const snapshot=(await api('snapshot')).value;const work=(await api('work')).value;
      const failed=work.tickets?.find((ticket:any)=>['failed','blocked'].includes(ticket.latestReport?.status));
      if(failed)throw new Error('LIVE_WORKER_FAILED');
      if(snapshot.tasks?.some((task:any)=>task.title===expected)&&work.messages?.some((message:any)=>
        message.threadId===submitted.value.threadId&&message.role==='assistant'&&work.tickets.some((ticket:any)=>
          ticket.id===message.ticketId&&ticket.latestReport?.status==='ready')))return {snapshot,work};
    });
    const task=result.snapshot.tasks.find((row:any)=>row.title===expected);
    assert.equal(task.status,'draft');assert.equal(task.checklist.length,2);
    report.scenarios.push({request:submitted.value,task,result});
    writeFileSync(join(evidence,'live-acceptance.json'),JSON.stringify(report,null,2));
    console.log(`Live scenario ${index+1} passed; persisted draft and native ready reply verified.`);
  }
}catch(error){failure=error;report.error=error instanceof Error?error.message:'LIVE_ACCEPTANCE_FAILED';}
finally{
  try{
    report.usage=(await api('status')).value;
    const db=new DatabaseSync(join(home,'data','model-budget.sqlite'),{readOnly:true});
    try{report.requests=db.prepare(`SELECT r.*,a.session_id,a.turn_seq,a.purpose,a.provider,a.model FROM model_requests r
      LEFT JOIN model_request_attribution a ON a.request_id=r.id ORDER BY r.created_at`).all();}finally{db.close();}
  }catch{}
  if(child&&child.exitCode===null){child.send('native-e2e-graceful-stop');await new Promise<void>(done=>{
    child!.once('exit',()=>done());setTimeout(()=>{child?.kill();done();},10000).unref();});}
  writeFileSync(join(evidence,'live-acceptance.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({evidence,passed:report.scenarios.length,error:report.error??null,
    requests:Array.isArray(report.requests)?report.requests.length:null}));
}
if(failure)process.exitCode=1;
