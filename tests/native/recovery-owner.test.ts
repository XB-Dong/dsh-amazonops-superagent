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
import { Store } from '../../vendor/superagent/src/extension.ts';

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
