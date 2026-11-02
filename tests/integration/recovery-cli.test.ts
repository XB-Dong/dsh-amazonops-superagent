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
  const put = (kind: string, id: string, data: object) => {
    const payload = { ...data, id, scope: 'main', kind, revision: 3, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' };
    db.prepare('INSERT INTO entities VALUES (?,?,?,?,?)').run('main', kind, id, 3, JSON.stringify(payload));
    return payload;
  };
  put('source', 'source-retained', { text: 'Synthetic checklist source', origin: 'user' });
  put('source', 'source-erased', { text: 'Sensitive synthetic source', origin: 'user' });
  const task = put('task', 'task-retained', { title: 'Synthetic migrated checklist', checklist: ['Check exact SKU'], checked: [false], status: 'draft', timeZone: 'Europe/Rome', sources: ['source-retained'] });
  put('memory', 'memory-erased', { key: 'synthetic', value: 'erased', status: 'confirmed', sources: ['source-erased'] });
  put('skill', 'skill-revoked', { status: 'active', sources: ['source-retained'], content: 'synthetic', hash: hash('synthetic') });
  db.close();
  const budgetFile = join(current, 'model-budget.sqlite');
  let budget = new ModelBudget(budgetFile, { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  budget.settle(budget.reserve(10, 10), { inputTokens: 8, outputTokens: 2 }); budget.close();
  copyFileSync(budgetFile, join(backup, 'model-budget.sqlite'));
  writeFileSync(join(backup, 'privacy-ledger.jsonl'), '');
  mkdirSync(join(backup, 'files')); writeFileSync(join(backup, 'files', 'sample.txt'), 'synthetic artifact\n');
  const names = ['business.sqlite', 'model-budget.sqlite', 'privacy-ledger.jsonl', 'files/sample.txt'];
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
  return { root, backup, current, destination, task, requestId };
}

test('old-format synthetic data restores into a new home with exact IDs, provenance, artifacts and current policy', () => {
  const f = fixture();
  const before = hash(readFileSync(join(f.backup, 'business.sqlite')));
  const restored = restoreLocal(f);
  assert.equal(restored.ok, true);
  assert.ok(existsSync(join(f.destination, 'business.sqlite')));
  const business = new Business(f.destination);
  try {
    assert.deepEqual(business.store.get('main', 'task-retained'), f.task);
    assert.deepEqual(business.snapshot('main').tasks.map(row => row.title), ['Synthetic migrated checklist']);
    assert.throws(() => business.store.get('main', 'memory-erased'));
    assert.equal(business.store.get<import('../../packages/business/core/store.ts').Base & { status: string }>('main', 'skill-revoked').status, 'revoked');
    assert.ok(business.store.db.prepare("SELECT name FROM sqlite_master WHERE name='business_events'").get());
  } finally { business.store.close(); }
  const db = new DatabaseSync(join(f.destination, 'model-budget.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM model_requests').get()?.n, 2);
    assert.equal(db.prepare('SELECT session_id FROM model_request_attribution WHERE request_id=?').get(f.requestId)?.session_id, 'worker-fixture');
  } finally { db.close(); }
  assert.equal(hash(readFileSync(join(f.backup, 'business.sqlite'))), before);
  assert.equal(hash(readFileSync(join(f.destination, 'files/sample.txt'))), hash('synthetic artifact\n'));
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
  const files = [join(f.backup, 'business.sqlite'), join(f.backup, 'manifest.json'), join(f.current, 'model-budget.sqlite'), join(f.current, 'privacy-ledger.jsonl')];
  const before = files.map(path => hash(readFileSync(path)));
  const result = spawnSync(process.execPath, [resolve('scripts/recovery.ts'), '--backup', f.backup,
    '--destination', f.destination, '--current', f.current], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.modelRequests, 2);
  assert.equal(summary.entities, 3);
  assert.equal(summary.privacyLedgerReapplied, true);
  assert.equal(typeof summary.entityDigest, 'string');
  assert.ok(!result.stdout.includes(f.root));
  assert.ok(!result.stdout.includes('Sensitive synthetic source'));
  assert.deepEqual(files.map(path => hash(readFileSync(path))), before);
  const bad = spawnSync(process.execPath, [resolve('scripts/recovery.ts'), '--backup', 'private-password-example'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1);
  assert.ok(!bad.stderr.includes('private-password-example'));
  assert.ok(bad.stderr.includes('INVALID_RECOVERY_ARGUMENTS'));
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
