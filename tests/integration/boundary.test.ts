import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Auth } from '../../packages/host/auth.ts';
import { allowedRequest, installBoundary } from '../../packages/host/boundary.ts';
import { spawn } from 'node:child_process';
import { createConnection,type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,mkdirSync,existsSync,realpathSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer as portServer } from 'node:net';
import { buildProject } from '../../scripts/build.mjs';
import { build } from 'esbuild';
import { localPatch } from '../../profiles/local.ts';
import { lineWriter,scrubEnvironment } from '../../scripts/start.mjs';

async function rawUpgrade(origin:string,path:string,headers:Record<string,string>,reset=true):Promise<{status:number;socket:Socket}>{
  return await new Promise((done,reject)=>{
    const url=new URL(origin);const socket=createConnection({host:url.hostname,port:Number(url.port)});let data='';
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('Raw upgrade timeout'));},2000);
    socket.on('error',()=>{});
    socket.once('connect',()=>socket.write([`GET ${path} HTTP/1.1`,`Host: ${url.host}`,'Connection: Upgrade','Upgrade: websocket','Sec-WebSocket-Version: 13',`Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,...Object.entries(headers).map(([key,value])=>`${key}: ${value}`),'',''].join('\r\n')));
    socket.on('data',chunk=>{data+=chunk.toString('latin1');if(!data.includes('\r\n\r\n'))return;clearTimeout(timer);const status=Number(/^HTTP\/1.1 (\d+)/.exec(data)?.[1]);if(reset)socket.resetAndDestroy();done({status,socket});});
  });
}

test('identity is derived from a server cookie, never a workspace header',()=>{
  const auth=new Auth('synthetic-password-for-test');
  const token=auth.login('synthetic-password-for-test');
  const headers={cookie:`amazonops_session=${token}`,'x-cc-workspace':'other'};
  assert.equal(auth.identity({headers})?.scope,'main');
  auth.logout({headers});assert.equal(auth.identity({headers}),undefined);
});
test('host and origin fences cover native routes and management is refused',()=>{
  const auth=new Auth('synthetic-password-for-test');
  const token=auth.login('synthetic-password-for-test');
  const origin='http://127.0.0.1:1234';
  const req={method:'GET',url:'/api',headers:{host:'127.0.0.1:1234'}};
  assert.equal(allowedRequest(req,origin,auth),401);
  const headers={...req.headers,cookie:`amazonops_session=${token}`};
  assert.equal(allowedRequest({...req,headers},origin,auth),200);
  assert.equal(allowedRequest({...req,method:'POST',headers},origin,auth),403);
  assert.equal(allowedRequest({...req,url:'/orchestrator/api/state',headers},origin,auth),403);
  assert.equal(allowedRequest({...req,headers:{...headers,host:'evil.test'}},origin,auth),403);
});
test('refused HTTP requests never invoke the existing native listener',async()=>{
  let dispatched=0;
  const server=createServer((_req,res)=>{dispatched++;res.end('native');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const auth=new Auth('synthetic-password-for-test');
  const dispose=installBoundary(server,origin,auth);
  try {
    const denied=await fetch(origin+'/api');assert.equal(denied.status,401);assert.equal(dispatched,0);
    const token=auth.login('synthetic-password-for-test');
    const accepted=await fetch(origin+'/api',{headers:{cookie:`amazonops_session=${token}`}});
    assert.equal(accepted.status,200);assert.equal(dispatched,1);
  } finally {dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('real rejected upgrade TCP resets never kill the host or reach the native owner',{timeout:20000},async t=>{
  const evidence=mkdtempSync(join(tmpdir(),'amazonops-boundary-socket-'));
  const child=spawn(process.execPath,['--experimental-transform-types',resolve('tests/integration/boundary-socket-fixture.ts'),evidence],
    {cwd:resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr!.on('data',chunk=>{stderr+=chunk;writeFileSync(join(evidence,'child-stderr.txt'),stderr);});
  let sequence=0;
  function message(predicate:(message:any)=>boolean):Promise<any>{return new Promise((done,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error(`Socket fixture timeout; exit=${child.exitCode}; ${stderr.slice(-1000)}`));},3000);
    const receive=(value:any)=>{if(predicate(value)){cleanup();done(value);}};
    const exit=()=>{cleanup();reject(new Error(`Socket fixture exited ${child.exitCode}; ${stderr.slice(-1000)}`));};
    const cleanup=()=>{clearTimeout(timer);child.off('message',receive);child.off('exit',exit);};
    child.on('message',receive);child.once('exit',exit);
  });}
  async function command(command:string){const id=++sequence;const result=message(value=>value.id===id);child.send({command,id});return result;}
  try{
    const ready=await message(value=>value.ready);let cookie=ready.cookie as string;const origin=ready.origin as string;
    const cases:{path:string;headers:Record<string,string>;status:number}[]=[{path:'/api/remote.mux',headers:{},status:401},
      {path:'/api/remote.mux',headers:{cookie,origin:'https://example.invalid'},status:403},
      {path:'/api/remote.mux?token=synthetic-query-token',headers:{},status:401},
      {path:'/orchestrator',headers:{cookie,origin},status:403}];
    for(const check of cases){
      for(let attempt=0;attempt<4;attempt++){
        const result=await rawUpgrade(origin,check.path,check.headers);assert.equal(result.status,check.status);
        await new Promise(done=>setTimeout(done,30));
        assert.equal(child.exitCode,null,`Rejected socket reset must remain local; ${stderr.slice(-1500)}`);
      }
    }
    assert.equal((await command('stats')).nativeUpgrades,0,'Refused upgrades must never dispatch the existing owner');
    const require=createRequire(realpathSync('node_modules/@deepseek-ai/dsh-api-gateway/package.json'));const WebSocket=require('ws');
    const client=new WebSocket(origin.replace('http:','ws:')+'/api/remote.mux',{headers:{cookie,origin}});
    await new Promise<void>((done,reject)=>{client.once('open',done);client.once('error',reject);});
    const echoed=new Promise<Buffer>(done=>client.once('message',done));client.send('native-owner-echo');assert.equal((await echoed).toString(),'native-owner-echo');
    const closed=new Promise<number>(done=>client.once('close',done));
    const logout=await fetch(origin+'/amazonops/api/logout',{method:'POST',headers:{origin,cookie}});assert.equal(logout.status,200);assert.equal(await closed,1001);
    assert.equal((await rawUpgrade(origin,'/api/remote.mux',{origin,cookie})).status,401);
    cookie=(await command('login')).cookie;
    const accepted=await rawUpgrade(origin,'/api/remote.mux',{origin,cookie},false);assert.equal(accepted.status,101);
    await fetch(origin+'/amazonops/api/logout',{method:'POST',headers:{origin,cookie}});
    accepted.socket.resetAndDestroy();await new Promise(done=>setTimeout(done,100));
    const stats=await command('stats');assert.equal(stats.nativeUpgrades,2);
    assert.equal(child.exitCode,null);assert.equal(existsSync(join(evidence,'fatal.json')),false);
    writeFileSync(join(evidence,'acceptance.json'),JSON.stringify({refusedResets:16,logoutAfterAcceptedReset:true,stats,fatal:false},null,2));
    t.diagnostic(`Real socket boundary evidence: ${evidence}; rejected resets=16; proper logout=1001; accepted owner preserved`);
  }finally{
    if(child.connected)child.send({command:'stop'});else child.kill();
    await new Promise<void>(done=>{if(child.exitCode!==null)done();else{child.once('exit',()=>done());setTimeout(()=>{child.kill('SIGKILL');done();},3000).unref();}});
  }
});

test('official native DSH gateway survives rejected resets, valid logout and an abrupt accepted peer reset',{timeout:45000},async t=>{
  const root=resolve('.');const home=mkdtempSync(join(tmpdir(),'amazonops-native-boundary-'));
  const evidence=join(home,'evidence');mkdirSync(evidence);
  await buildProject({root});const probe=join(root,'lib/boundary-native-probe.js');
  await build({entryPoints:[join(root,'tests/integration/native-e2e-probe.ts')],outfile:probe,bundle:true,packages:'external',platform:'node',format:'esm',target:'node24'});
  const portSocket=portServer();await new Promise<void>(done=>portSocket.listen(0,'127.0.0.1',done));const port=(portSocket.address() as {port:number}).port;await new Promise<void>(done=>portSocket.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`,password='synthetic-native-boundary-password';
  const patch=join(home,'profile.json');writeFileSync(patch,JSON.stringify([{insert:[{id:'boundary-observer',name:probe.replaceAll('\\','/'),config:{evidence}}]},...localPatch({root,home,password,port,live:false,modelAccount:'test'})]));
  const network=join(evidence,'network.jsonl');writeFileSync(network,'');const env=scrubEnvironment(process.env,home);env.AMAZONOPS_NETWORK_EVIDENCE=network;
  const child=spawn(process.execPath,['--require',join(root,'tests/integration/native-e2e-network.cjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let logs='',cookie='';const writer=lineWriter((text:string)=>{logs+=text;writeFileSync(join(evidence,'host.log'),logs);},[password]);child.stdout!.on('data',chunk=>writer.push(String(chunk)));child.stderr!.on('data',chunk=>writer.push(String(chunk)));
  async function login(){const response=await fetch(origin+'/amazonops/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(1000)});if(!response.ok)throw new Error('NATIVE_LOGIN_FAILED');cookie=response.headers.get('set-cookie')!.split(';')[0];}
  async function alive(){assert.equal(child.exitCode,null,logs.slice(-2000));const response=await fetch(origin+'/amazonops/login',{signal:AbortSignal.timeout(1000)});assert.equal(response.status,200);}
  try{
    const deadline=Date.now()+15000;while(!cookie&&Date.now()<deadline){if(child.exitCode!==null)throw new Error(logs.slice(-2000));try{await login();}catch{await new Promise(done=>setTimeout(done,100));}}
    assert.ok(cookie,'Native host must start');
    while((!logs.includes('dsh web:')||!existsSync(join(evidence,'native-state.json')))&&Date.now()<deadline){
      if(child.exitCode!==null)throw new Error(logs.slice(-2000));await new Promise(done=>setTimeout(done,100));
    }
    assert.ok(logs.includes('dsh web:')&&existsSync(join(evidence,'native-state.json')),'Wait for official application readiness before testing its native gateway');
    const cases:{headers:Record<string,string>;status:number;path?:string}[]=[{headers:{},status:401},{headers:{cookie,origin:'https://example.invalid'},status:403},{headers:{},status:401,path:'/api/remote.mux?token=synthetic-token'},{headers:{cookie,origin},status:403,path:'/orchestrator'}];
    for(const check of cases)for(let attempt=0;attempt<3;attempt++){
      assert.equal((await rawUpgrade(origin,check.path??'/api/remote.mux',check.headers)).status,check.status);await alive();
    }
    const require=createRequire(realpathSync(join(root,'node_modules/@deepseek-ai/dsh-api-gateway/package.json')));const WebSocket=require('ws');
    const client=new WebSocket(origin.replace('http:','ws:')+'/api/remote.mux',{headers:{cookie,origin}});
    await new Promise<void>((done,reject)=>{client.once('open',done);client.once('error',reject);});
    const closed=new Promise<number>((done,reject)=>{const timer=setTimeout(()=>{client.terminate();reject(new Error('NATIVE_LOGOUT_CLOSE_TIMEOUT'));},3000);client.once('close',(code:number)=>{clearTimeout(timer);done(code);});});
    const logout=await fetch(origin+'/amazonops/api/logout',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});assert.equal(logout.status,200);assert.equal(await closed,1001);
    assert.equal((await rawUpgrade(origin,'/api/remote.mux',{origin,cookie})).status,401);await alive();
    await login();const abrupt=await rawUpgrade(origin,'/api/remote.mux',{cookie,origin},false);assert.equal(abrupt.status,101);
    await fetch(origin+'/amazonops/api/logout',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:'{}'});abrupt.socket.resetAndDestroy();await new Promise(done=>setTimeout(done,100));
    await alive();await login();const status=await(await fetch(origin+'/amazonops/api/status',{headers:{origin,cookie}})).json() as any;assert.equal(status.budget.used.calls,0);
    assert.ok(readFileSync(network,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).every(row=>row.allowed));
    writeFileSync(join(evidence,'acceptance.json'),JSON.stringify({nativeRejectedResets:12,properLogout:1001,oldCookieDenied:401,abruptAcceptedResetSurvived:true,modelCalls:0},null,2));
    t.diagnostic(`Official DSH boundary evidence: ${evidence}; native WS logout=1001; old cookie=401; host alive; model calls=0`);
  }finally{
    if(child.connected)child.send('native-e2e-graceful-stop');else child.kill();await new Promise<void>(done=>{if(child.exitCode!==null)done();else{child.once('exit',()=>done());setTimeout(()=>{child.kill('SIGKILL');done();},5000).unref();}});
  }
});
