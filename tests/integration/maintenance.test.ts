import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync, symlinkSync } from 'node:fs';
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
    { id: 'pending', revision: 1, decision: 'partially_delivered_scope_pending' },
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
  const options = { data, registry, authority, owner: 'synthetic-owner', now };
  const init = () => initializeMaintenance({ ...options, destination: state });
  let reportNumber = 0;
  const check = (mode = 'handover_validation') => checkMaintenance({ ...options, state, mode,
    output: join(root, `report-${++reportNumber}.json`) }) as any;
  return { root, data, db, registry, authority, authorityValue, state, options, put, init, check };
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
    const initialized = invoke('init', ...common, '--destination', f.state);
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
