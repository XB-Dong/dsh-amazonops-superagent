import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {buildProject} from '../../scripts/build.mjs';
import {scrubEnvironment} from '../../scripts/start.mjs';

test('Linux official launcher reports an unexpected native child signal as failure for service restart',
  {skip:process.platform!=='linux',timeout:45000},async()=>{
    const root=resolve('.'),home=mkdtempSync(join(tmpdir(),'amazonops-launcher-failure-'));
    const socket=createServer();await new Promise<void>(done=>socket.listen(0,'127.0.0.1',done));
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    writeFileSync(join(home,'settings.json'),JSON.stringify({project:'dsh-amazonops-superagent',
      password:'synthetic-launcher-restart-password',port,modelAccount:'test'}));
    await buildProject({root});
    const parent=spawn(process.execPath,['scripts/start.mjs'],{cwd:root,
      env:{...scrubEnvironment(process.env,home),AMAZONOPS_HOME:home},stdio:['ignore','pipe','pipe']});
    let logs='';parent.stdout.on('data',chunk=>{logs+=String(chunk);});parent.stderr.on('data',chunk=>{logs+=String(chunk);});
    const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(done=>parent.once('exit',(code,signal)=>done({code,signal})));
    let nativePid:number|undefined;
    try{
      const deadline=Date.now()+20000;let ready=false;
      while(Date.now()<deadline){
        assert.equal(parent.exitCode,null,logs);
        try{const r=await fetch(`http://127.0.0.1:${port}/ready`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json() as any).ready){ready=true;break;}}catch{}
        await new Promise(done=>setTimeout(done,100));
      }
      assert.ok(ready,logs);
      const children=readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`,'utf8').trim().split(/\s+/).map(Number);
      const owned=children.filter(pid=>readFileSync(`/proc/${pid}/cmdline`,'utf8').includes('@deepseek-ai/dsh/lib/bin.js'));
      assert.equal(owned.length,1,'Only the actual owned official DSH child may be stopped');nativePid=owned[0];
      process.kill(nativePid,'SIGKILL');
      const result=await exited;
      assert.equal(result.code,1,'Unexpected native child termination must activate systemd Restart=on-failure');
      assert.equal(result.signal,null);
      assert.equal(readdirSync(home).filter(name=>/^launch-.*\.json$/.test(name)).length,0,'The surviving launcher must clean its own private launch patch');
    }finally{
      if(parent.exitCode===null&&parent.signalCode===null){parent.kill('SIGTERM');await exited;}
      if(nativePid){try{process.kill(nativePid,0);assert.fail('Owned native child survived launcher shutdown');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
      writeFileSync(join(home,'launcher.log'),logs);
    }
  });
