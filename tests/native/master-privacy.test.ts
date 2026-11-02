/** Context map: runtime master identity, Sessions delivery/model/tool guards, dynamic index hooks.
 * Self-review: real official DSH host and model traffic; no replacement loop or direct core edits.
 * All secrets, ledger, raw histories and network evidence are synthetic and outside Git. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { operationsPatch } from '../../profiles/operations.ts';
import { scrubEnvironment, lineWriter } from '../../scripts/start.mjs';
import { fakeModel } from '../integration/native-e2e-model.ts';

test('privacy epoch closes old master steps, queued inputs and historical tools before clean native restart', { timeout: 90000 }, async t => {
  const root = resolve('.');
  const home = mkdtempSync(join(tmpdir(), 'amazonops-master-privacy-'));
  const evidence = join(home, 'evidence'); mkdirSync(evidence);
  writeFileSync(join(home, 'epoch.txt'), 'first');
  const model = await fakeModel(evidence);
  const output = join(root, 'vendor/superagent/lib');
  await build({ entryPoints: [join(root, 'vendor/superagent/src/index.ts')], outfile: join(output, 'index.js'),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const fixture = `
    import {readFileSync,writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    import {z} from 'zod';
    import {freezeMessage,MessageId} from '@deepseek-ai/dsh-llm';
    export const inject=['webServer','sessionPersistence','agents'];
    export function apply(ctx,config){
      let runtime;
      const epoch=()=>readFileSync(join(config.home,'epoch.txt'),'utf8');
      ctx.provide('amazonopsHooks',{privacy:{epoch,
        allowMasterInput:input=>!input.text.includes('deleted-trigger-id'),
        authorizeTool:(agent,ticket,name,args)=>{if(JSON.stringify(args).includes('deleted-trigger-id'))throw new Error('SOURCE_DELETED');}
      }});
      ctx.inject(['orchestrator'],async child=>{
        const next=child.get('orchestrator');await next.ready;
        const off=next.sources.register({kind:'privacyprobe',title:{zh:'隐私测试',en:'Privacy fixture'},description:{zh:'合成来源',en:'Synthetic source'},
          schema:z.object({}),fields:[],health:[],scope:()=>({listened:true,observed:false}),
          policy:{schema:z.object({allowed:z.array(z.object({id:z.string()}))}),fields:[],explicit:{zh:'测试请求',en:'Fixture request'}}});
        child.effect(()=>off);
        const policy=next.settings.block('policy');
        await next.settings.save('policy',{...policy.value,sources:{...policy.value.sources,privacyprobe:{allowed:[{id:'cc'}]}}},policy.revision,'sync');
        runtime=next;
      });
      process.on('message',message=>{if(message==='privacy-test-stop')process.emit('SIGTERM');});
      ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/privacy-probe',handler:async(req,res)=>{
        try{
          const command=new URL(req.url,'http://localhost').searchParams.get('command');
          if(!runtime)throw new Error('NOT_READY');
          const agent=ctx.agents.get(runtime.masterId);
          if(command==='seed')await runtime.sessions.prompt(runtime.masterId,'first-safe-input','PRIVACY_SENTINEL_FROM_DELETED_SOURCE','queue');
          if(command==='advance'){
            writeFileSync(join(config.home,'epoch.txt'),'second');
            // Bypass only the producer to test the real model-request guard on an already loaded agent.
            agent.followup(freezeMessage({id:MessageId('privacy-old-step'),role:'user',content:[{type:'text',text:'continue old session'}],source:{kind:'dsh-superagent',form:'relay'}}));
          }
          if(command==='rotate'){
            // Persist genuinely queued native relay/notice effects from the retired generation.
            runtime.sessions.relay('stale-relay','STALE_RELAY_SENTINEL');
            runtime.sessions.notify('stale-notice',{text:'STALE_NOTICE_SENTINEL'},'stale');
            runtime.receive({id:'deleted-trigger-id',source:'privacyprobe',threads:[{source:'privacyprobe',id:'deleted-thread'}],
              actor:{source:'privacyprobe',id:'cc'},human:true,addressed:'direct',at:new Date().toISOString(),text:'DELETED_CANDIDATE_SENTINEL',meta:{}});
            runtime.store.db.prepare("UPDATE effect SET due=? WHERE kind IN ('relay','notice','assessment')").run(Date.now()+1000);
            const old=runtime.masterId;
            await runtime.checkpoint(async()=>{});
            res.setHeader('content-type','application/json');res.end(JSON.stringify({old}));return;
          }
          if(command==='blocked-inputs'){
            runtime.sessions.relay('deleted-report','{"trigger_id":"deleted-trigger-id","text":"DELETED_REPORT_SENTINEL"}');
            runtime.sessions.notify('deleted-notice',{trigger_id:'deleted-trigger-id',text:'DELETED_NOTICE_SENTINEL'},'deleted');
          }
          if(command==='fresh')await runtime.sessions.prompt(runtime.masterId,'fresh-input','FRESH_SAFE_INPUT','queue');
          let denied=false;
          if(command==='tools'){
            const outcome=await agent.ctx.tools.execute({callId:'privacy-denied-route',name:'orchestrator_route',arguments:{decisions:[{kind:'ignore',trigger_id:'deleted-trigger-id',reason:'no'}]},agent,signal:new AbortController().signal});
            denied=outcome.isError;
          }
          res.setHeader('content-type','application/json');
          res.end(JSON.stringify({masterId:runtime.masterId,epoch:runtime.privacyEpoch,status:agent.status,denied,
            tools:agent.ctx.tools.schemas(agent).map(tool=>tool.name),
            events:agent.session.snapshotEvents(),pending:runtime.store.db.prepare("SELECT kind,value FROM effect WHERE kind IN ('relay','notice','assessment')").all()}));
        }catch(error){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
      }}));
    }
  `;
  const probe = join(output, 'master-privacy-probe.js');
  await build({ stdin: { contents: fixture, resolveDir: root, loader: 'ts' }, outfile: probe,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const socket = createServer();
  await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(done => socket.close(() => done()));
  const patch = join(home, 'patch.json');
  writeFileSync(patch, JSON.stringify([
    { insert: [{ id: 'privacy-test-host', name: probe.replaceAll('\\', '/'), config: { home } }] },
    ...operationsPatch(join(home, 'state'), join(output, 'index.js').replaceAll('\\', '/')),
    { id: 'webserver', config: { host: '127.0.0.1', port } },
    { id: 'llm-deepseek', config: { baseURL: model.url, apiKeyEnv: 'AMAZONOPS_API_KEY', thinking: 'disabled', retryPolicy: { mode: 'normal', maxRetries: 0 } } },
  ]));
  const network = join(evidence, 'network.jsonl');writeFileSync(network, '');
  const env = scrubEnvironment(process.env, home, 'synthetic-privacy-fixture-key');env.AMAZONOPS_NETWORK_EVIDENCE=network;
  const child = spawn(process.execPath, ['--require', join(root, 'tests/integration/native-e2e-network.cjs'),
    join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs='';const writer=lineWriter((text:string)=>{logs+=text;writeFileSync(join(evidence,'host.log'),logs);},['synthetic-privacy-fixture-key']);
  child.stdout!.on('data',chunk=>writer.push(String(chunk)));child.stderr!.on('data',chunk=>writer.push(String(chunk)));
  const call=async(command='')=>{const response=await fetch(`http://127.0.0.1:${port}/privacy-probe?command=${command}`,{signal:AbortSignal.timeout(3000)});const data=await response.json() as any;if(!response.ok)throw new Error(data.error);return data;};
  const wait=async(predicate:()=>Promise<any>,name:string)=>{const deadline=Date.now()+20000;while(Date.now()<deadline){try{const value=await predicate();if(value)return value;}catch{}await new Promise(done=>setTimeout(done,50));}throw new Error(`${name}: ${logs.slice(-4000)}; evidence=${home}`);};
  try {
    const initial=await wait(async()=>{const state=await call();return state.status==='idle'&&state;},'initial master');
    await call('seed');
    await wait(async()=>model.requests.length===1&&(await call()).status==='idle','first real native request');
    await call('advance');
    await wait(async()=>(await call()).status==='idle','old master denied turn');
    assert.equal(model.requests.length,1,'Changing durable privacy epoch must block the next old-master LLM request before the provider');
    const rotation=await call('rotate');
    const clean=await wait(async()=>{const state=await call();return state.masterId!==rotation.old&&state.status==='idle'&&state;},'clean master after checkpoint');
    assert.notEqual(clean.masterId,initial.masterId);
    assert.equal(clean.epoch,'second');
    assert.deepEqual(clean.tools.sort(),['orchestrator_reply','orchestrator_route']);
    const denied=await call('tools');assert.equal(denied.denied,true);
    await call('blocked-inputs');
    await new Promise(done=>setTimeout(done,1200));
    await call('fresh');
    await wait(async()=>model.requests.length>=2&&(await call()).status==='idle','fresh native request');
    assert.equal(model.requests.length,2,'Revoked candidates and stale queued effects must not invoke the model');
    const requests=readFileSync(join(evidence,'model-requests.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(JSON.stringify(requests[0].body).includes('PRIVACY_SENTINEL_FROM_DELETED_SOURCE'));
    const newBody=JSON.stringify(requests[1].body);
    assert.ok(newBody.includes('FRESH_SAFE_INPUT'));
    for(const secret of ['PRIVACY_SENTINEL_FROM_DELETED_SOURCE','STALE_RELAY_SENTINEL','STALE_NOTICE_SENTINEL','DELETED_CANDIDATE_SENTINEL','DELETED_REPORT_SENTINEL','DELETED_NOTICE_SENTINEL'])assert.ok(!newBody.includes(secret),secret);
    const final=await wait(async()=>{const state=await call();return state.pending.length===0&&state;},'discard stale native queued inputs');
    assert.equal(final.pending.length,0);
    assert.ok(readFileSync(network,'utf8').trim().split('\n').map(line=>JSON.parse(line)).every(row=>row.allowed));
    writeFileSync(join(evidence,'acceptance.json'),JSON.stringify({initialMaster:initial.masterId,newMaster:clean.masterId,requests:model.requests.length,tools:clean.tools,denied:denied.denied},null,2));
    t.diagnostic(`Master privacy evidence: ${home}; real local model requests=2; external attempts=0`);
  } finally {
    if(child.connected)child.send('privacy-test-stop');else child.kill();
    await new Promise<void>(done=>{if(child.exitCode!==null)done();else{child.once('exit',()=>done());setTimeout(()=>{child.kill('SIGKILL');done();},5000).unref();}});
    model.server.closeAllConnections();await new Promise<void>(done=>model.server.close(()=>done()));
  }
});
