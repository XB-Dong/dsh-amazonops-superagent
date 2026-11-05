import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeMaintenance, checkMaintenance } from '../../packages/business/maintenance/index.ts';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function tree(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = lstatSync(path);
    return [name, stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? tree(path) : sha(readFileSync(path))];
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-maintenance-test-'));
  const data = join(root, 'data'); mkdirSync(data);
  const database = join(data, 'business.sqlite');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE entities(scope TEXT,kind TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE tombstones(scope TEXT,id TEXT,deleted_at TEXT,PRIMARY KEY(scope,id));`);
  function put(id: string, kind = 'feedback', extra: Record<string, unknown> = {}, scope = 'main') {
    const payload = { id, kind, scope, revision: 1, updatedAt: '2026-11-05T00:00:00.000Z', text: 'Synthetic only',
      status: 'captured', count: 1, amendments: [], sources: [], ...extra };
    db.prepare('INSERT OR REPLACE INTO entities VALUES (?,?,?,?,?)').run(scope, kind, id, payload.revision, JSON.stringify(payload));
  }
  put('delivered'); put('pending'); put('other', 'feedback', {}, 'test-workspace');
  const registry = join(root, 'legacy-registry.json');
  writeFileSync(registry, JSON.stringify({ feedbackRevisions: [
    { id: 'delivered', revision: 1, decision: 'delivered' },
    { id: 'pending', revision: 1, decision: 'partially_delivered_personal_ordering_pending', pending: { reason: 'Synthetic user confirmation required' } },
    { id: 'deleted', revision: 2, decision: 'implemented_source_deleted_excluded' },
    { id: 'withdrawn', revision: 2, decision: 'withdrawn_excluded' },
    { id: 'duplicate', revision: 1, decision: 'duplicate_excluded' },
  ] }));
  const authority = join(root, 'authority.json');
  const now = () => new Date('2026-11-05T12:00:00.000Z');
  const authorityValue = { project: 'dsh-amazonops-superagent', productionActive: true, legacyMaintenanceStopped: true,
    ownerThreadId: 'synthetic-owner', businessDelivery: 'handover', expiresAt: '2026-11-05T12:30:00.000Z' };
  writeFileSync(authority, JSON.stringify(authorityValue));
  const state = join(root, 'maintenance-state.json');
  const priorData = join(root, 'frozen-prior'); mkdirSync(priorData);
  const freezePrior = () => { for (const name of readdirSync(data)) copyFileSync(join(data, name), join(priorData, name)); };
  freezePrior();
  const options = { data, priorData, registry, authority, owner: 'synthetic-owner', now };
  const init = () => initializeMaintenance({ ...options, destination: state });
  let reportNumber = 0;
  const check = (mode = 'handover_validation') => checkMaintenance({ ...options, state, mode,
    output: join(root, `report-${++reportNumber}.json`) }) as any;
  return { root, data, priorData, freezePrior, db, registry, authority, authorityValue, state, options, put, init, check };
}

test('maintenance: initialized legacy history has no actionable change and inputs remain unchanged with active WAL', () => {
  const f = fixture();
  try {
    const registryBytes = readFileSync(f.registry), before = tree(f.data);
    const initialized = f.init() as any;
    assert.equal(initialized.feedbackCount, 2);
    const stateBytes = readFileSync(f.state);
    const report = f.check();
    assert.equal(report.actionable, false); assert.equal(report.modelCalls, 0); assert.equal(report.newWaves, 0);
    assert.equal(report.legacyHistoryCount, 5);
    assert.deepEqual(tree(f.data), before); assert.deepEqual(readFileSync(f.registry), registryBytes);
    assert.deepEqual(readFileSync(f.state), stateBytes);
    assert.throws(f.init, /OUTPUT_EXISTS/);
  } finally { f.db.close(); }
});

test('maintenance: full payload detects count, pending supplement and same-version revocation', () => {
  const f = fixture();
  try {
    f.init(); f.put('delivered', 'feedback', { count: 2, amendments: [{ text: 'Synthetic addition', sourceId: 'new-source' }] });
    const first = f.check();
    assert.equal(first.actionable, true); assert.equal(first.changes.feedback.changed.length, 1);
    assert.equal(first.changes.feedback.changed[0].id, 'delivered');
    assert.equal(first.changes.feedback.changed[0].previousDecision, 'delivered');
    f.put('pending', 'feedback', { status: 'withdrawn' });
    const second = f.check();
    assert.equal(second.changes.feedback.changed.length, 2);
  } finally { f.db.close(); }
});

test('maintenance: new, deleted and pending capture records are compared as complete sets', () => {
  const f = fixture();
  try {
    f.init(); f.put('new-feedback');
    f.db.prepare('DELETE FROM entities WHERE scope=? AND id=?').run('main', 'pending');
    f.db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run('main', 'pending', '2026-11-05T12:00:00Z');
    f.put('new-source', 'source', { origin: 'user' });
    f.put('capture-job', 'job', { type: 'capture', status: 'pending', sourceId: 'new-source' });
    const report = f.check();
    assert.deepEqual(report.changes.feedback.added.map((x: any) => x.id), ['new-feedback']);
    assert.deepEqual(report.changes.feedback.removed.map((x: any) => x.id), ['pending']);
    assert.equal(report.changes.pendingCapture.added.length, 2);
    assert.equal(report.changes.tombstones.added.length, 1);
    assert.equal(report.changes.feedback.added.some((x: any) => x.id === 'other'), false);
  } finally { f.db.close(); }
});

test('maintenance: excluded historical reappearance is an integrity finding, never a fresh approved feature', () => {
  const f = fixture();
  try {
    f.init(); f.put('deleted');
    const report = f.check();
    assert.equal(report.changes.feedback.excludedReappeared.length, 1);
    assert.equal(report.changes.feedback.excludedReappeared[0].id, 'deleted');
    assert.equal(report.canDevelop, false);
    assert.equal(report.newWaves, 0);
  } finally { f.db.close(); }
});

test('maintenance: fresh matching authority is mandatory; only completed delivery permits ordinary checks', () => {
  const f = fixture();
  try {
    f.init(); assert.throws(() => f.check('daily'), /DELIVERY_NOT_COMPLETED/);
    for (const changed of [ { ownerThreadId: 'different' }, { expiresAt: '2026-11-05T11:59:59Z' },
      { project: 'ccagent' }, { productionActive: false }, { legacyMaintenanceStopped: false } ]) {
      writeFileSync(f.authority, JSON.stringify({ ...f.authorityValue, ...changed }));
      assert.throws(() => f.check(), /AUTHORITY/);
    }
    writeFileSync(f.authority, JSON.stringify({ ...f.authorityValue, businessDelivery: 'completed' }));
    assert.equal(f.check('daily').actionable, false);
  } finally { f.db.close(); }
});

test('maintenance: absent, corrupt or mismatched state fails closed without publishing a report', () => {
  const f = fixture();
  try {
    assert.throws(() => f.check(), /STATE/);
    f.init(); writeFileSync(f.state, '{}');
    assert.throws(() => f.check(), /STATE/);
    assert.equal(existsSync(join(f.root, 'report-1.json')), false);
  } finally { f.db.close(); }
});

test('maintenance: private reports cannot overwrite inputs or be written inside a Git repository', () => {
  const f = fixture();
  try {
    f.init();
    assert.throws(() => checkMaintenance({ ...f.options, state: f.state, mode: 'handover_validation', output: f.registry }), /OUTPUT|OVERLAP/);
    const repository = join(f.root, 'repository'); mkdirSync(repository); mkdirSync(join(repository, '.git'));
    assert.throws(() => checkMaintenance({ ...f.options, state: f.state, mode: 'handover_validation', output: join(repository, 'report.json') }), /OUTPUT_IN_REPOSITORY/);
    const linked = join(f.root, 'linked'); symlinkSync(f.data, linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => initializeMaintenance({ ...f.options, data: linked, destination: join(f.root, 'linked-state.json') }), /LINK/);
  } finally { f.db.close(); }
});

test('maintenance: copied baseline cannot silently inspect another runtime data root', () => {
  const f = fixture(), other = fixture();
  try {
    f.init();
    assert.throws(() => checkMaintenance({ ...f.options, data: other.data, state: f.state, mode: 'handover_validation',
      output: join(f.root, 'wrong-runtime.json') }), /STATE_SOURCE_MISMATCH/);
    assert.equal(existsSync(join(f.root, 'wrong-runtime.json')), false);
  } finally { f.db.close(); other.db.close(); }
});

test('maintenance: real CLI performs a private check and stdout contains only aggregate results', () => {
  const f = fixture();
  try {
    writeFileSync(f.authority, JSON.stringify({ ...f.authorityValue,
      expiresAt: new Date(Date.now() + 600000).toISOString() }));
    const common = ['--data', f.data, '--registry', f.registry, '--authority', f.authority, '--owner', 'synthetic-owner'];
    const before = tree(f.data);
    const invoke = (...args: string[]) => spawnSync(process.execPath, ['--experimental-transform-types',
      resolve('scripts/maintenance.ts'), ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    const missingCheckpoint=invoke('init',...common,'--destination',f.state);
    assert.equal(missingCheckpoint.status,1);assert.match(missingCheckpoint.stderr,/MAINTENANCE_ARGUMENTS_INVALID/);
    assert.equal(existsSync(f.state),false);
    const initialized = invoke('init', ...common, '--prior-data', f.priorData, '--destination', f.state);
    assert.equal(initialized.status, 0, initialized.stderr);
    f.put('new-cli-feedback');
    const reportPath = join(f.root, 'private-cli-report.json');
    const checked = invoke('check', ...common, '--state', f.state, '--mode', 'handover_validation', '--output', reportPath);
    assert.equal(checked.status, 0, checked.stderr);
    const response = JSON.parse(checked.stdout);
    assert.equal(response.actionable, true); assert.equal(response.feedbackChanges, 1);
    for (const privateValue of ['new-cli-feedback', 'Synthetic only', 'synthetic-owner', f.root])
      assert.equal(checked.stdout.includes(privateValue), false);
    assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).changes.feedback.added[0].id, 'new-cli-feedback');
    const failed = invoke('check', ...common, '--state', f.state, '--mode', 'invalid', '--output', join(f.root, 'invalid.json'));
    assert.equal(failed.status, 1); assert.match(failed.stderr, /MAINTENANCE_MODE_INVALID/);
    assert.equal(failed.stderr.includes(f.root), false);
    assert.notDeepEqual(tree(f.data), before, 'the deliberate fixture write is represented in the active WAL');
  } finally { f.db.close(); }
});

test('maintenance: processed user sources and derived tool sources are not pending feedback work', () => {
  const f = fixture();
  try {
    f.init();
    f.put('processed-source', 'source', { origin: 'user' });
    f.put('completed-job', 'job', { type: 'capture', status: 'completed', sourceId: 'processed-source' });
    f.put('derived-source', 'source', { origin: 'tool' });
    assert.equal(f.check().actionable, false);
  } finally { f.db.close(); }
});

test('maintenance: check timestamps alone do not become new actionable feedback', () => {
  const f = fixture();
  try {
    f.init();
    const registry = JSON.parse(readFileSync(f.registry, 'utf8'));
    registry.lastCheckedAt = '2026-11-05T12:01:00.000Z';
    writeFileSync(f.registry, JSON.stringify(registry));
    const report = f.check();
    assert.equal(report.actionable, false); assert.equal(report.registryChanged, false);
    assert.equal(report.registryBytesChanged, true);
  } finally { f.db.close(); }
});

test('maintenance: unresolved capture already present at handover remains visible until actually drained', () => {
  const f = fixture();
  try {
    f.put('initial-source', 'source', { origin: 'user' });
    f.put('initial-capture', 'job', { type: 'capture', status: 'pending', sourceId: 'initial-source' });
    f.freezePrior();
    f.init();
    const pending = f.check();
    assert.equal(pending.pendingCaptureOutstanding, true); assert.equal(pending.actionable, true);
    assert.equal(pending.changes.pendingCapture.added.length, 0, 'it was pending before baseline initialization');
    f.put('initial-capture', 'job', { type: 'capture', status: 'completed', sourceId: 'initial-source' });
    const drained = f.check();
    assert.equal(drained.pendingCaptureOutstanding, false); assert.equal(drained.actionable, false);
    assert.equal(drained.changes.pendingCapture.removed.length, 2);
  } finally { f.db.close(); }
});

test('maintenance: initialization never absorbs suggestions, same-revision amendments, withdrawals or deletions after the audited checkpoint', () => {
  for (const scenario of ['new', 'metadata-unchanged-payload', 'supplement', 'withdrawn', 'deleted']) {
    const f = fixture();
    try {
      if (scenario === 'new') f.put('latest-before-init');
      if (scenario === 'metadata-unchanged-payload') f.put('delivered', 'feedback', { text: 'Synthetic changed text with identical revision/status/timestamp' });
      if (scenario === 'supplement') f.put('delivered', 'feedback', { count: 2, amendments: [{ text: 'Synthetic new supplement', sourceId: 'new-source' }] });
      if (scenario === 'withdrawn') f.put('delivered', 'feedback', { status: 'withdrawn' });
      if (scenario === 'deleted') {
        f.db.prepare('DELETE FROM entities WHERE scope=? AND id=?').run('main', 'delivered');
        f.db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run('main', 'delivered', '2026-11-05T12:00:00Z');
      }
      const before=tree(f.data),priorBefore=tree(f.priorData);f.init();
      const initialized=JSON.parse(readFileSync(f.state,'utf8'));
      assert.equal(initialized.snapshot.feedback.length,2,'checkpoint keeps the reviewed earlier complete set');
      assert.equal(initialized.initializedSnapshot.feedback.length,scenario==='new'?3:scenario==='deleted'?1:2);
      assert.notEqual(initialized.sourceIdentity,initialized.checkpointSourceIdentity,'checks bind final production rather than the frozen copy');
      const first=f.check(),second=f.check();
      assert.equal(first.actionable,true,`${scenario} must survive initialization`);
      assert.equal(second.actionable,true,`${scenario} must remain outstanding without explicit resolution`);
      assert.deepEqual(second.changes.feedback,first.changes.feedback);
      const group=scenario==='new'?'added':scenario==='deleted'?'removed':'changed';
      assert.equal(first.changes.feedback[group].length,1);
      assert.deepEqual(tree(f.data),before);assert.deepEqual(tree(f.priorData),priorBefore);
    } finally { f.db.close(); }
  }
});

test('maintenance: complete legacy metadata is retained and unknown or unregistered history remains outstanding', () => {
  for (const scenario of ['known-pending', 'unknown', 'missing-decision', 'no-registry']) {
    const f=fixture();try {
      const registry=JSON.parse(readFileSync(f.registry,'utf8'));
      registry.feedbackRevisions[0]={...registry.feedbackRevisions[0],contentHash:'legacy-hash-uses-another-algorithm',status:'captured',sourceUpdatedAt:'Synthetic unchanged source time',pending:['Synthetic held scope']};
      if(scenario==='unknown')registry.feedbackRevisions[0].decision='unclassified_old_suggestion';
      if(scenario==='missing-decision')delete registry.feedbackRevisions[0].decision;
      if(scenario==='no-registry')registry.feedbackRevisions=registry.feedbackRevisions.filter((row:any)=>row.id!=='delivered');
      writeFileSync(f.registry,JSON.stringify(registry));f.init();
      const state=JSON.parse(readFileSync(f.state,'utf8'));
      assert.deepEqual(state.legacyDecisions,registry.feedbackRevisions);
      assert.deepEqual(state.legacyRegistry,registry);
      const report=f.check();assert.equal(report.actionable,scenario!=='known-pending');
      assert.equal(report.canDevelop,false);assert.equal(report.modelCalls,0);assert.equal(report.newWaves,0);
    }finally{f.db.close();}
  }
});

test('maintenance: a reviewed separate checkpoint is mandatory and all output paths protect the prior input tree',()=>{
  const f=fixture();try {
    const {priorData,...withoutCheckpoint}=f.options;
    assert.throws(()=>initializeMaintenance({...withoutCheckpoint,destination:f.state} as any),/CHECKPOINT_REQUIRED/);
    assert.throws(()=>initializeMaintenance({...f.options,priorData:f.data,destination:f.state}),/CHECKPOINT_OVERLAP/);
    assert.throws(()=>initializeMaintenance({...f.options,destination:join(priorData,'state.json')}),/OUTPUT_OVERLAP/);
    const linked=join(f.root,'linked-prior');symlinkSync(priorData,linked,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>initializeMaintenance({...f.options,priorData:linked,destination:f.state}),/LINK/);
    const before=tree(priorData);f.init();
    assert.throws(()=>checkMaintenance({...f.options,state:f.state,mode:'handover_validation',output:join(priorData,'report.json')}),/OUTPUT_OVERLAP/);
    assert.deepEqual(tree(priorData),before);
    const old=JSON.parse(readFileSync(f.state,'utf8'));old.schemaVersion='amazonops-maintenance/1';writeFileSync(f.state,JSON.stringify(old));
    assert.throws(()=>f.check(),/STATE_INVALID/);
  }finally{f.db.close();}
});

test('maintenance: initialization preserves prior privacy changes and complete registry metadata changes',()=>{
  const f=fixture();try {
    writeFileSync(join(f.data,'privacy-ledger.jsonl'),'Synthetic private deletion event\n');
    f.init();const first=f.check();assert.equal(first.privacyChanged,true);assert.equal(first.actionable,true);
    const registry=JSON.parse(readFileSync(f.registry,'utf8'));
    registry.feedbackRevisions[0].sourceUpdatedAt='Synthetic amendment without changing decision or revision';
    registry.feedbackRevisions[0].pending={reason:'Synthetic updated pending scope'};writeFileSync(f.registry,JSON.stringify(registry));
    const second=f.check();assert.equal(second.registryChanged,true);assert.equal(second.actionable,true);
    assert.equal(second.legacyHistoryCount,5);assert.equal(second.canDevelop,false);
  }finally{f.db.close();}
});
