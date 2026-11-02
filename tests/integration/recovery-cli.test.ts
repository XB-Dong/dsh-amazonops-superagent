import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ModelBudget } from '../../packages/business/core/budget.ts';
import { Business } from '../../packages/business/application.ts';
import { restoreLocal } from '../../scripts/recovery.ts';
import type { Base } from '../../packages/contracts/model.ts';
import { projectInventory } from '../../packages/business/operations/inventory.ts';
import { analyzeAds } from '../../packages/business/operations/advertising.ts';
import { legacyBusinessPayloads } from './fixtures/legacy-business.ts';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function treeSnapshot(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = lstatSync(path);
    return [name, stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? treeSnapshot(path) : hash(readFileSync(path))];
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-recovery-cli-'));
  const backup = join(root, 'backup'), current = join(root, 'current'), destination = join(root, 'new-home', 'data');
  mkdirSync(backup); mkdirSync(current);
  const db = new DatabaseSync(join(backup, 'business.sqlite'));
  db.exec(`CREATE TABLE entities(scope TEXT,kind TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE receipts(scope TEXT,request_key TEXT,result TEXT,PRIMARY KEY(scope,request_key));
    CREATE TABLE tombstones(scope TEXT,id TEXT,deleted_at TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE privacy_applied(id TEXT PRIMARY KEY);`);
  const insert = (payload: Base) => {
    db.prepare('INSERT INTO entities VALUES (?,?,?,?,?)').run(payload.scope, payload.kind, payload.id, payload.revision, JSON.stringify(payload));
    return payload;
  };
  const put = (kind: string, id: string, data: object) => {
    const payload = { ...data, id, scope: 'main', kind, revision: 3, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' };
    insert(payload);
    return payload;
  };
  const retainedSource = put('source', 'source-retained', { text: 'Synthetic checklist source', origin: 'user' });
  put('source', 'source-erased', { text: 'Sensitive synthetic source', origin: 'user' });
  const task = put('task', 'task-retained', { title: 'Synthetic migrated checklist', checklist: ['Check exact SKU'], checked: [false], status: 'draft', timeZone: 'Europe/Rome', confirmedSuccess: false, sources: ['source-retained'] });
  put('memory', 'memory-erased', { text: 'Synthetic erased fact', key: 'synthetic', value: 'erased', status: 'confirmed', sources: ['source-erased'] });
  const legacy = legacyBusinessPayloads();
  const revokedSkill = put('skill', 'skill-revoked', { ...legacy.skill, name: 'Synthetic revoked workflow', status: 'active' });
  for (const row of [...legacy.retained, ...legacy.histories]) insert(row);
  db.prepare('INSERT INTO receipts VALUES (?,?,?)').run('main', 'legacy-task-receipt', JSON.stringify(task));
  db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run('main', 'legacy-deleted-entity', '2025-01-02T00:00:00Z');
  const expected = [retainedSource, task, { ...revokedSkill, status: 'revoked' }, ...legacy.retained];
  const originalEntitiesCount = Number(db.prepare('SELECT COUNT(*) AS n FROM entities').get()?.n);
  db.close();
  const budgetFile = join(current, 'model-budget.sqlite');
  let budget = new ModelBudget(budgetFile, { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  budget.settle(budget.reserve(10, 10), { inputTokens: 8, outputTokens: 2 }); budget.close();
  copyFileSync(budgetFile, join(backup, 'model-budget.sqlite'));
  writeFileSync(join(backup, 'privacy-ledger.jsonl'), '');
  mkdirSync(join(backup, 'files')); writeFileSync(join(backup, 'files', 'sample.txt'), 'synthetic artifact\n');
  mkdirSync(join(backup, 'files', 'imports'));
  writeFileSync(join(backup, 'files', 'imports', 'legacy-sales.csv'), 'Date,SKU,Units\n2025-01-07,000123,2\n');
  const names = ['business.sqlite', 'model-budget.sqlite', 'privacy-ledger.jsonl', 'files/sample.txt', 'files/imports/legacy-sales.csv'];
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ schemaVersion: '1.0', files: names.map(path => {
    const bytes = readFileSync(join(backup, path)); return { path, bytes: bytes.length, sha256: hash(bytes) };
  }) }));
  budget = new ModelBudget(budgetFile, { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  const requestId = budget.reserve(20, 10);
  budget.db.exec('CREATE TABLE model_request_attribution(request_id TEXT PRIMARY KEY,session_id TEXT,turn_seq INTEGER,purpose TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL)');
  budget.db.prepare('INSERT INTO model_request_attribution VALUES (?,?,?,?,?,?)').run(requestId, 'worker-fixture', 2, 'compaction', 'fixture', 'fixture'); budget.close();
  writeFileSync(join(current, 'privacy-ledger.jsonl'), [
    { scope: 'main', id: 'source-erased', action: 'delete', at: '2026-01-01T00:00:00Z' },
    { scope: 'main', id: 'skill-revoked', action: 'revoke', at: '2026-01-01T00:00:01Z' },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  return { root, backup, current, destination, task, requestId, expected, originalEntitiesCount, legacy };
}

test('old-format synthetic data restores into a new home with exact IDs, provenance, artifacts and current policy', () => {
  const f = fixture();
  const before = { backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) };
  const restored = restoreLocal(f);
  assert.equal(restored.ok, true);
  assert.equal(restored.entities, f.expected.length);
  assert.deepEqual({ backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) }, before);
  assert.ok(existsSync(join(f.destination, 'business.sqlite')));
  const business = new Business(f.destination);
  try {
    assert.deepEqual(business.store.get('main', 'task-retained'), f.task);
    assert.deepEqual(JSON.parse(String(business.store.db.prepare('SELECT result FROM receipts WHERE scope=? AND request_key=?').get('main', 'legacy-task-receipt')?.result)), f.task);
    assert.equal(business.store.isDeleted('main', 'legacy-deleted-entity'), true);
    for (const expected of f.expected) {
      assert.deepEqual(business.store.get('main', expected.id), expected, `Exact legacy payload: ${expected.kind}/${expected.id}`);
      assert.equal(business.store.db.prepare('SELECT revision FROM entities WHERE scope=? AND id=?').get('main', expected.id)?.revision, expected.revision);
    }
    const snapshot = business.snapshot('main');
    const collections = { reports: 'report', forecasts: 'forecast', inventories: 'inventory', pools: 'pool',
      allocations: 'allocation', shipments: 'shipment', adAnalyses: 'adAnalysis', activities: 'activity',
      reminders: 'reminder', notes: 'note', feedback: 'feedback', tasks: 'task', memories: 'memory', skills: 'skill' } as const;
    for (const key of Object.keys(collections) as (keyof typeof collections)[]) {
      assert.deepEqual(snapshot[key], f.expected.filter(row => row.kind === collections[key]).reverse(), `Exact business snapshot: ${key}`);
    }
    assert.deepEqual(projectInventory(f.legacy.inventory, f.legacy.forecast.dailyDemand), f.legacy.inventory.projection);
    assert.deepEqual(JSON.parse(JSON.stringify(analyzeAds(f.legacy.ads, f.legacy.analysis.options))), f.legacy.analysis.groups);
    assert.deepEqual(snapshot.sessions, [], 'Legacy CC conversations must never become native sessions');
    assert.equal(snapshot.summary, null, 'Privacy replay retires stale legacy summaries');
    for (const row of f.legacy.histories) {
      assert.throws(() => business.store.get('main', row.id), /NOT_FOUND/);
      assert.equal(business.store.isDeleted('main', row.id), true);
    }
    assert.throws(() => business.store.get('main', 'memory-erased'));
    assert.equal(business.store.get<import('../../packages/business/core/store.ts').Base & { status: string }>('main', 'skill-revoked').status, 'revoked');
    assert.ok(business.store.db.prepare("SELECT name FROM sqlite_master WHERE name='business_events'").get());
  } finally { business.store.close(); }
  const db = new DatabaseSync(join(f.destination, 'model-budget.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM model_requests').get()?.n, 2);
    assert.equal(db.prepare('SELECT session_id FROM model_request_attribution WHERE request_id=?').get(f.requestId)?.session_id, 'worker-fixture');
  } finally { db.close(); }
  assert.deepEqual({ backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) }, before);
  const manifest = JSON.parse(readFileSync(join(f.backup, 'manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
  for (const file of manifest.files.filter(file => file.path.startsWith('files/'))) {
    assert.equal(hash(readFileSync(join(f.destination, file.path))), file.sha256);
  }
  assert.equal(existsSync(join(f.destination, 'harness')), false);
});

test('CLI refuses overlap and nonempty destination without changing inputs or publishing partial output', () => {
  const f = fixture();
  assert.throws(() => restoreLocal({ ...f, destination: join(f.current, 'inside') }));
  mkdirSync(f.destination, { recursive: true }); writeFileSync(join(f.destination, 'keep.txt'), 'preserve');
  assert.throws(() => restoreLocal(f));
  assert.equal(readFileSync(join(f.destination, 'keep.txt'), 'utf8'), 'preserve');
  const g = fixture();
  writeFileSync(join(g.backup, 'files/sample.txt'), 'corrupted');
  assert.throws(() => restoreLocal(g));
  assert.equal(existsSync(g.destination), false);
});

test('actual CLI produces metadata only and never changes backup or current input files', () => {
  const f = fixture();
  const before = { backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) };
  const result = spawnSync(process.execPath, [resolve('scripts/recovery.ts'), '--backup', f.backup,
    '--destination', f.destination, '--current', f.current], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.modelRequests, 2);
  assert.equal(summary.entities, f.expected.length);
  assert.equal(summary.privacyLedgerReapplied, true);
  assert.equal(typeof summary.entityDigest, 'string');
  assert.ok(!result.stdout.includes(f.root));
  assert.ok(!result.stdout.includes('Sensitive synthetic source'));
  assert.deepEqual({ backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) }, before);
  const bad = spawnSync(process.execPath, [resolve('scripts/recovery.ts'), '--backup', 'private-password-example'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1);
  assert.ok(!bad.stderr.includes('private-password-example'));
  assert.ok(bad.stderr.includes('INVALID_RECOVERY_ARGUMENTS'));
});

test('legacy CC conversations remain exact offline SQLite archives without privacy retirement and are never native sessions', () => {
  const f = fixture();
  const ledgerPath = join(f.current, 'privacy-ledger.jsonl');
  const revokeOnly = readFileSync(ledgerPath, 'utf8').split('\n').filter(line => line && JSON.parse(line).action === 'revoke');
  writeFileSync(ledgerPath, revokeOnly.join('\n') + '\n');
  const before = { backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) };
  const restored = restoreLocal(f);
  const business = new Business(f.destination);
  try {
    assert.equal(restored.entities, f.originalEntitiesCount, 'No delete intent means source/memory and legacy histories survive');
    for (const history of f.legacy.histories) assert.deepEqual(business.store.get('main', history.id), history);
    assert.deepEqual(business.store.list('main', 'conversation'), [f.legacy.conversation]);
    assert.deepEqual(business.snapshot('main').sessions, []);
    assert.equal(business.store.list('main', 'nativeSession').length, 0);
    assert.equal(existsSync(join(f.destination, 'harness')), false);
    assert.deepEqual({ backup: treeSnapshot(f.backup), current: treeSnapshot(f.current) }, before);
  } finally { business.store.close(); }
});

test('merge failure leaves no published directory or partial staging data', () => {
  const f = fixture();
  const budget = new DatabaseSync(join(f.current, 'model-budget.sqlite'));
  budget.prepare('INSERT INTO model_request_attribution VALUES (?,?,?,?,?,?)').run('orphan-request', 'worker', 1, 'conversation', 'fixture', 'fixture');
  budget.close();
  assert.throws(() => restoreLocal(f), /MODEL_ATTRIBUTION_ORPHAN/);
  assert.equal(existsSync(f.destination), false);
  assert.deepEqual(readdirSync(join(f.root, 'new-home')), []);
});

test('manifest traversal and directory links cannot read outside the selected backup', () => {
  const f = fixture();
  const manifestPath = join(f.backup, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files.push({ path: '../current/privacy-ledger.jsonl', bytes: 0, sha256: '' });
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => restoreLocal(f), /BACKUP_PATH_FORBIDDEN/);
  const g = fixture();
  const outside = join(g.root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'sample.txt'), 'synthetic artifact\n');
  symlinkSync(outside, join(g.backup, 'linked'), 'junction');
  const linkedManifest = JSON.parse(readFileSync(join(g.backup, 'manifest.json'), 'utf8'));
  linkedManifest.files.push({ path: 'linked/sample.txt', bytes: 19, sha256: hash('synthetic artifact\n') });
  writeFileSync(join(g.backup, 'manifest.json'), JSON.stringify(linkedManifest));
  assert.throws(() => restoreLocal(g), /BACKUP_SYMLINK_FORBIDDEN/);
  assert.equal(existsSync(g.destination), false);
});

test('original input and destination junctions are rejected before realpath can erase their identity', async t => {
  for (const kind of ['backup-root', 'backup-ancestor', 'current-root', 'current-ancestor', 'destination-root', 'destination-ancestor']) {
    await t.test(kind, () => {
      const f = fixture(); const options = { ...f };
      const key = kind.split('-')[0] as 'backup' | 'current' | 'destination';
      const alias = join(f.root, 'alias');
      if (kind.endsWith('-root')) {
        const target = key === 'destination' ? join(f.root, 'empty-target') : f[key];
        if (key === 'destination') mkdirSync(target);
        symlinkSync(target, alias, 'junction'); options[key] = alias;
      } else {
        symlinkSync(f.root, alias, 'junction');
        options[key] = join(alias, key === 'destination' ? 'new-home/data' : key);
      }
      const before = treeSnapshot(f.root);
      assert.throws(() => restoreLocal(options), /RESTORE_PATH_LINK_FORBIDDEN/);
      assert.deepEqual(treeSnapshot(f.root), before);
      assert.equal(existsSync(f.destination), false);
    });
  }
});
