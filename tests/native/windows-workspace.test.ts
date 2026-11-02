/** Windows CI context: Node tmpdir may use RUNNER~1 while DSH publishes the
 * physical long name. Exercise actual aliases and native startup/recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,writeFileSync,mkdirSync,symlinkSync,renameSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scrubEnvironment } from '../../scripts/start.mjs';
import { OperationsWorkspaceAuthority } from '../../vendor/superagent/src/app/operations-workspace.ts';

function alias(directory:string):string {
  assert.ok(!/["%!\r\n]/.test(directory),'Read-only cmd short-name query requires a literal safe generated path');
  const result=spawnSync('cmd.exe',['/d','/v:off','/c',`for %I in ("${directory}") do @echo %~sI`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
test('real Windows 8.3 TEMP alias supports native master and restored worker execution',{
  skip:process.platform!=='win32',timeout:150000,
},t=>{
  const evidence=mkdtempSync(join(tmpdir(),'amazonops-dos-alias-evidence-'));
  const long=realpathSync.native(mkdtempSync(join(tmpdir(),'amazonops-real-long-temp-alias-'))),short=alias(long);
  assert.notEqual(resolve(short).toLowerCase(),resolve(long).toLowerCase(),'Use a real 8.3 alias rather than a case-only mock');
  assert.equal(realpathSync.native(short),long);assert.match(short,/~[A-Z0-9]+/i);
  writeFileSync(join(evidence,'physical-alias.json'),JSON.stringify({long,short},null,2));
  for(const file of ['tests/native/native-startup.test.ts','tests/integration/native-e2e-queued.test.ts']){
    const result=spawnSync(process.execPath,['--experimental-transform-types','--test',file],{
      cwd:resolve('.'),env:{...scrubEnvironment(process.env,join(long,'isolated-driver-home')),TEMP:short,TMP:short},windowsHide:true,encoding:'utf8',timeout:110000,
    });
    writeFileSync(join(evidence,file.includes('queued')?'queued-output.txt':'master-output.txt'),`${result.stdout}\n${result.stderr}`);
    assert.equal(result.status,0,`${file} must accept a real short-name TEMP: ${result.stdout.slice(-3500)} ${result.stderr.slice(-1000)}; evidence=${evidence}`);
    assert.match(result.stdout,/tests\s+[1-9]\d*/,'Nested runner must actually execute tests, not inherit NODE_TEST_CONTEXT and skip');
  }
  t.diagnostic(`Real 8.3 native evidence: ${evidence}`);
});

test('physical authority rejects a linked root ancestor before creating anything through it',()=>{
  const base=mkdtempSync(join(tmpdir(),'amazonops-workspace-root-link-'));
  const outside=join(base,'outside');mkdirSync(outside);
  const link=join(base,'linked-parent');symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>new OperationsWorkspaceAuthority(join(link,'forbidden-state')),/OPERATIONS_WORKSPACE_LINK_FORBIDDEN/);
  assert.equal(existsSync(join(outside,'forbidden-state')),false,'Reject before the first mkdir/lock/storage write');
});
test('physical authority rejects a linked work ancestor before worker mkdir',()=>{
  const base=mkdtempSync(join(tmpdir(),'amazonops-workspace-work-link-'));
  const authority=new OperationsWorkspaceAuthority(join(base,'state'));
  const outside=join(base,'outside');mkdirSync(outside);
  symlinkSync(outside,join(authority.root,'work'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>authority.prepareDirectory(join(authority.root,'work','forbidden-worker')),/OPERATIONS_WORKSPACE_LINK_FORBIDDEN/);
  assert.equal(existsSync(join(outside,'forbidden-worker')),false);
});
test('matching realpaths cannot authorize a workspace replaced by an outward junction',()=>{
  const base=mkdtempSync(join(tmpdir(),'amazonops-workspace-swap-link-'));
  const authority=new OperationsWorkspaceAuthority(join(base,'state'));
  const worker=authority.prepareDirectory(join(authority.root,'work','safe-worker'));
  const outside=join(base,'outside');mkdirSync(outside);
  renameSync(worker,`${worker}.retired`);symlinkSync(outside,worker,process.platform==='win32'?'junction':'dir');
  assert.equal(realpathSync.native(worker),realpathSync.native(outside));
  assert.throws(()=>authority.assertWorkspace(worker,worker),/OPERATIONS_WORKSPACE_LINK_FORBIDDEN/);
});
test('a regular root replacement with identical spelling does not inherit the pinned authority',()=>{
  const base=mkdtempSync(join(tmpdir(),'amazonops-workspace-root-replace-'));
  const authority=new OperationsWorkspaceAuthority(join(base,'state'));
  renameSync(authority.root,`${authority.root}.retired`);mkdirSync(authority.root);
  assert.throws(()=>authority.assertRoot(),/OPERATIONS_WORKSPACE_CHANGED/);
});
test('different physical old directories and missing directories never pass the execution guard',()=>{
  const base=mkdtempSync(join(tmpdir(),'amazonops-workspace-old-'));
  const authority=new OperationsWorkspaceAuthority(join(base,'state'));
  const worker=authority.prepareDirectory(join(authority.root,'work','safe-worker'));
  const old=join(base,'old-home');mkdirSync(old);
  assert.throws(()=>authority.assertWorkspace(worker,old),/OPERATIONS_WORKSPACE_CHANGED/);
  assert.throws(()=>authority.assertWorkspace(worker,join(base,'missing')));
});
