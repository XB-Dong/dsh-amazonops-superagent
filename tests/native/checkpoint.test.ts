import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { operationsPatch } from '../../profiles/operations.ts';
import { redactOutput } from '../../scripts/start.mjs';

test('native checkpoint closes the actual store and rebuilds the fiber after capture success or failure', { timeout: 60000 }, async () => {
  const root = resolve('.');
  const home = mkdtempSync(join(tmpdir(), 'amazonops-checkpoint-'));
  const entry = join(root, 'vendor/superagent/lib/checkpoint-probe.js');
  const source = `
    import {Config,machineOf,Runtime} from './vendor/superagent/src/extension.ts';
    export {Config};
    export const inject=['agents','sessionController','sessionPersistence','workspaceRegistry','permissionPresets','tools','systemPrompt','skills','webServer','llm','subprocess'];
    let generation=0;
    export async function apply(ctx,config){
      const current=++generation;
      const runtime=new Runtime(ctx,machineOf(config),()=>{void ctx.fiber.restart();});
      ctx.effect(()=>()=>runtime.stop());
      await runtime.ready;
      ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/checkpoint-probe',handler:async(req,res)=>{
        res.setHeader('content-type','application/json');
        if(req.method==='GET'){res.end(JSON.stringify({generation:current,configured:runtime.configured()}));return;}
        try{
          const value=await runtime.checkpoint(async()=>{
            let storeClosed=false;
            try{runtime.store.db.prepare('SELECT 1').get();}catch{storeClosed=true;}
            if(req.url.includes('fail=1'))throw new Error('synthetic capture failure');
            return {storeClosed,generation:current};
          });
          res.end(JSON.stringify(value));
        }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
      }}));
    }
  `;
  await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, outfile: entry,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const socket = createServer();
  await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(done => socket.close(() => done()));
  const patch = join(home, 'patch.json');
  writeFileSync(patch, JSON.stringify([...operationsPatch(join(home, 'state'), entry.replaceAll('\\', '/')),
    { id: 'webserver', config: { host: '127.0.0.1', port } },
    { id: 'llm-deepseek', config: { apiKeyEnv: 'AMAZONOPS_OFFLINE_KEY', baseURL: 'http://127.0.0.1:1' } },
  ]));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  environment.DSH_HOME = join(home, 'harness'); environment.AMAZONOPS_OFFLINE_KEY = 'offline-only';
  const child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open'],
    { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += redactOutput(chunk); });
  child.stderr.on('data', chunk => { logs += redactOutput(chunk); });
  const url = `http://127.0.0.1:${port}/checkpoint-probe`;
  async function waitGeneration(minimum: number) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || logs.includes('entry did not activate')) throw new Error(logs.slice(-6000));
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          const value = await response.json() as { generation: number; configured: boolean };
          if (value.generation >= minimum && value.configured) return value;
        }
      } catch { /* A restarting provider temporarily removes its route. */ }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Native fiber did not reach generation ${minimum}: ${logs.slice(-6000)}`);
  }
  try {
    await waitGeneration(1);
    const successful = await fetch(url, { method: 'POST' });
    const captured = await successful.json() as { storeClosed: boolean; generation: number };
    assert.equal(successful.status, 200, JSON.stringify(captured));
    assert.equal(captured.storeClosed, true);
    await waitGeneration(2);
    const failing = await fetch(`${url}?fail=1`, { method: 'POST' });
    assert.equal(failing.status, 500);
    assert.match(await failing.text(), /synthetic capture failure/);
    await waitGeneration(3);
  } finally {
    child.kill();
    await new Promise<void>(done => { if (child.exitCode !== null) done(); else child.once('exit', () => done()); });
  }
});
