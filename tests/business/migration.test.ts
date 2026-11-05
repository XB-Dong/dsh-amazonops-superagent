import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync, symlinkSync, rmSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Business } from '../../packages/business/application.ts';
import { exportMigrationSnapshot, validateMigrationSnapshot, compareMigrationSnapshots, stageMigration } from '../../packages/business/core/migration.ts';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function tree(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name); return [name, lstatSync(path).isDirectory() ? tree(path) : sha(readFileSync(path))];
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-migration-')), source = join(root, 'source'); mkdirSync(source);
  const db = new DatabaseSync(join(source, 'business.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE entities(scope TEXT,kind TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE receipts(scope TEXT,request_key TEXT,result TEXT,PRIMARY KEY(scope,request_key));
    CREATE TABLE tombstones(scope TEXT,id TEXT,deleted_at TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE privacy_applied(id TEXT PRIMARY KEY);`);
  const put = (id: string, kind: string, extra: object) => {
    const payload = { id, kind, scope: 'main', revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra };
    db.prepare('INSERT INTO entities VALUES (?,?,?,?,?)').run('main', kind, id, payload.revision, JSON.stringify(payload)); return payload;
  };
  put('source-a', 'source', { origin: 'user', text: 'Synthetic pending suggestion' });
  put('job-a', 'job', { type: 'capture', status: 'pending', attempts: 0, sourceId: 'source-a' });
  const feedback = put('feedback-a', 'feedback', { text: 'Synthetic suggestion', count: 2, status: 'captured', sources: ['source-a'], amendments: [{ text: 'Pending addition', sourceId: 'source-a' }] });
  const skill = put('skill-a', 'skill', { status: 'active', sources: ['source-a'] });
  put('change-a', 'change', { feedbackId: 'feedback-a', text: 'Previously confirmed', revision: 4, feedbackRevision: 1, status: 'confirmed', amendments: [], sources: ['source-a'] });
  db.prepare('INSERT INTO receipts VALUES (?,?,?)').run('main', 'capture-receipt', JSON.stringify({ id: 'feedback-a', revision: 1 }));
  db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run('main', 'already-erased', '2026-01-01T00:00:00Z');
  const budget = new DatabaseSync(join(source, 'model-budget.sqlite'));
  budget.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE model_requests(id TEXT PRIMARY KEY,input_tokens INTEGER,output_tokens INTEGER,settled INTEGER,usage_verified INTEGER,created_at TEXT);
    INSERT INTO model_requests VALUES ('legacy-request',50,10,1,0,'2026-01-01T00:00:00Z');`);
  writeFileSync(join(source, 'privacy-ledger.jsonl'), '');
  mkdirSync(join(source, 'files')); writeFileSync(join(source, 'files', 'source.txt'), 'synthetic file\n');
  const registryPath = join(root, 'private-feedback-state.json');
  const registry = { feedbackRevisions: [{ id: 'feedback-a', revision: 1, decision: 'partially_delivered_pending', pending: ['Synthetic unresolved scope'] }, { id: 'withdrawn-feedback', decision: 'withdrawn_excluded' }], nextIteration: 4 };
  writeFileSync(registryPath, JSON.stringify(registry));
  return { root, source, db, budget, put, feedback, skill, registry, registryPath, close: () => { db.close(); budget.close(); } };
}

function shortName(path: string): string {
  assert.ok(!/["%!\r\n]/.test(path), 'Read-only short-name query requires a safe generated path');
  const result = spawnSync('cmd.exe', ['/d', '/v:off', '/c', `for %I in ("${path}") do @echo %~sI`],
    { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
  assert.equal(result.status, 0, result.stderr);
  const alias = result.stdout.trim();
  assert.match(alias, /~/, 'Exercise a real DOS short alias, not a case-only mock');
  assert.notEqual(resolve(alias).toLowerCase(), resolve(path).toLowerCase());
  return alias;
}

test('Windows mixed short source and long registry still rejects private registry inside product data', {
  skip: process.platform !== 'win32',
}, async () => {
  const f = fixture();
  try {
    const source = realpathSync.native(f.source), alias = shortName(source);
    const registryPath = join(source, 'private-feedback-state.json'); writeFileSync(registryPath, JSON.stringify(f.registry));
    const before = tree(source);
    for (const paths of [{ source: alias, registryPath }, { source, registryPath: join(alias, 'private-feedback-state.json') }]) {
      const destination = join(f.root, 'mixed-registry-snapshot');
      await assert.rejects(exportMigrationSnapshot({ ...f, ...paths, destination, sourceQuiesced: false }), /MIGRATION_REGISTRY_INSIDE_SOURCE/);
      assert.equal(existsSync(destination), false);
      assert.deepEqual(tree(source), before, 'Guard rejection must not write into input DB/WAL/SHM or registry');
    }
  } finally { f.close(); }
});

test('Windows short TEMP runs the original registry containment case with actual tests', {
  skip: process.platform !== 'win32', timeout: 30000,
}, () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'amazonops-real-long-registry-temp-')));
  try {
    const alias = shortName(root), env: NodeJS.ProcessEnv = { ...process.env, TEMP: alias, TMP: alias };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--experimental-transform-types', '--test',
      '--test-name-pattern=^registry cannot be accidentally included inside product source data$', 'tests/business/migration.test.ts'],
    { cwd: resolve('.'), env, encoding: 'utf8', windowsHide: true, timeout: 25000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /tests\s+1\b/, 'Nested runner must actually execute the selected original test');
    assert.match(result.stdout, /pass\s+1\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Windows CLI short repository alias cannot publish private output into the repository', {
  skip: process.platform !== 'win32',
}, () => {
  const f = fixture();
  try {
    f.close();
    // Hosted Windows checkout volumes may disable DOS names. Exercise the actual CLI on the
    // same TEMP volume as the other real-alias probes, without depending on checkout aliases.
    const checkout = join(f.root, 'Long isolated migration repository checkout'); mkdirSync(checkout);
    const root = realpathSync.native(checkout), alias = shortName(root);
    for (const file of ['scripts/migration.ts', 'packages/business/core/migration.ts',
      'packages/business/core/migration-files.ts', 'packages/business/core/migration-stage.ts',
      'packages/business/core/migration-state.ts', 'packages/business/core/store.ts',
      'packages/business/core/privacy.ts', 'packages/business/core/budget.ts']) {
      const output = join(root, file); mkdirSync(dirname(output), { recursive: true });
      copyFileSync(resolve(file), output);
    }
    // All imported runtime dependencies of this CLI are Node built-ins; no install or stub.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const destination = join(root, 'migration-alias-output-denied'), before = tree(f.source);
    for (const paths of [
      { script: join(alias, 'scripts', 'migration.ts'), destination },
      { script: join(root, 'scripts', 'migration.ts'), destination: join(alias, 'migration-alias-output-denied') },
    ]) {
      const result = spawnSync(process.execPath, ['--experimental-transform-types', paths.script, 'export',
        '--source', f.source, '--destination', paths.destination, '--registry', f.registryPath,
        '--source-quiesced', 'false'], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 1, result.stdout);
      assert.equal(JSON.parse(result.stderr.trim().split('\n').at(-1)!).error, 'MIGRATION_OUTPUT_INSIDE_REPOSITORY');
      assert.equal(existsSync(destination), false);
      assert.deepEqual(tree(f.source), before);
    }
  } finally {
    try { f.close(); } catch {}
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Windows physical alias cannot publish a migration candidate inside its source snapshot', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture();
  try {
    const snapshot = join(f.root, 'Long migration snapshot directory');
    await exportMigrationSnapshot({ ...f, destination: snapshot, sourceQuiesced: true });
    const result = spawnSync('cmd.exe', ['/d', '/v:off', '/c', `for %I in ("${snapshot}") do @echo %~sI`],
      { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
    assert.equal(result.status, 0);
    const alias = result.stdout.trim(); assert.ok(alias.length > 0);
    const before = tree(snapshot);
    await assert.rejects(stageMigration({ snapshot, destination: join(alias, 'nested-candidate') }), /MIGRATION_INPUT_OVERLAP/);
    assert.deepEqual(tree(snapshot), before);
  } finally { f.close(); }
});

test('migration snapshots include live WAL, all tables and pending queue without mutating input', async () => {
  const f = fixture();
  try {
    assert.ok(readFileSync(join(f.source, 'business.sqlite-wal')).length > 0);
    const before = tree(f.source), registryBefore = readFileSync(f.registryPath);
    const destination = join(f.root, 'snapshot');
    await exportMigrationSnapshot({ ...f, destination, sourceQuiesced: false });
    assert.deepEqual(tree(f.source), before); assert.deepEqual(readFileSync(f.registryPath), registryBefore);
    const manifest = validateMigrationSnapshot(destination) as { sourceQuiesced: boolean };
    assert.equal(manifest.sourceQuiesced, false);
    const db = new DatabaseSync(join(destination, 'data', 'business.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM entities').get()?.n, 5);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM entities WHERE kind='job'").get()?.n, 1);
      assert.deepEqual(JSON.parse(String(db.prepare('SELECT payload FROM entities WHERE id=?').get('feedback-a')?.payload)), f.feedback);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM receipts').get()?.n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM tombstones').get()?.n, 1);
    } finally { db.close(); }
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'maintenance', 'feedback-state.json'), 'utf8')), f.registry);
  } finally { f.close(); }
});

test('full-set comparison detects new suggestion, same-revision revocation and removed entity', async () => {
  const f = fixture();
  try {
    const a = join(f.root, 'a'), b = join(f.root, 'b');
    await exportMigrationSnapshot({ ...f, destination: a, sourceQuiesced: false });
    f.put('feedback-new', 'feedback', { text: 'Arrived after rehearsal', sources: ['source-a'] });
    f.db.prepare('UPDATE entities SET payload=? WHERE id=?').run(JSON.stringify({ ...f.skill, status: 'revoked' }), 'skill-a');
    f.db.prepare('DELETE FROM entities WHERE id=?').run('change-a');
    await exportMigrationSnapshot({ ...f, destination: b, sourceQuiesced: false });
    const diff = compareMigrationSnapshots(a, b) as { added: unknown[]; changed: unknown[]; removed: unknown[]; equal: boolean };
    assert.equal(diff.equal, false); assert.equal(diff.added.length, 1); assert.equal(diff.changed.length, 1); assert.equal(diff.removed.length, 1);
  } finally { f.close(); }
});

test('final migration refuses rehearsal, publishes fresh bundle with private registry and legacy usage', async () => {
  const f = fixture();
  try {
    const rehearsal = join(f.root, 'rehearsal');
    await exportMigrationSnapshot({ ...f, destination: rehearsal, sourceQuiesced: false });
    await assert.rejects(stageMigration({ snapshot: rehearsal, destination: join(f.root, 'not-final') }), /MIGRATION_SOURCE_NOT_QUIESCED/);
    f.close();
    const final = join(f.root, 'final'), destination = join(f.root, 'candidate');
    await exportMigrationSnapshot({ ...f, destination: final, sourceQuiesced: true });
    const sourceBefore = tree(f.source);
    await stageMigration({ snapshot: final, destination });
    assert.deepEqual(tree(f.source), sourceBefore);
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'maintenance', 'feedback-state.json'), 'utf8')), f.registry);
    const budget = new DatabaseSync(join(destination, 'data', 'model-budget.sqlite'), { readOnly: true });
    try { const row = budget.prepare('SELECT * FROM model_requests').get(); assert.equal(row?.id, 'legacy-request'); assert.equal(row?.usage_verified, 0); assert.equal(row?.input_tokens, 50); }
    finally { budget.close(); }
    assert.ok(existsSync(join(destination, 'migration-receipt.json')));
    await assert.rejects(stageMigration({ snapshot: final, destination }), /MIGRATION_TARGET_NOT_EMPTY/);
  } finally { try { f.close(); } catch {} }
});

test('snapshot validation rejects missing files, added files, tampering and path traversal', async () => {
  const f = fixture();
  try {
    const destination = join(f.root, 'snapshot'); await exportMigrationSnapshot({ ...f, destination, sourceQuiesced: false });
    const manifestPath = join(destination, 'manifest.json'), original = readFileSync(manifestPath);
    const manifest = JSON.parse(original.toString()); manifest.files.pop(); writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => validateMigrationSnapshot(destination), /MIGRATION_HASH_OR_SET_MISMATCH/);
    writeFileSync(manifestPath, original); writeFileSync(join(destination, 'unlisted.txt'), 'unlisted');
    assert.throws(() => validateMigrationSnapshot(destination), /MIGRATION_HASH_OR_SET_MISMATCH/);
    rmSync(join(destination, 'unlisted.txt')); writeFileSync(join(destination, 'data', 'files', 'source.txt'), 'modified');
    assert.throws(() => validateMigrationSnapshot(destination), /MIGRATION_HASH_OR_SET_MISMATCH/);
    const evil = JSON.parse(original.toString()); evil.files[0].path = '../outside'; writeFileSync(manifestPath, JSON.stringify(evil));
    assert.throws(() => validateMigrationSnapshot(destination), /MIGRATION_PATH_FORBIDDEN/);
  } finally { f.close(); }
});

test('all SQLite files must be in the logical database inventory', async () => {
  const f = fixture();
  try {
    const extra = new DatabaseSync(join(f.source, 'additional.sqlite')); extra.exec('CREATE TABLE extra(id TEXT PRIMARY KEY,value TEXT); INSERT INTO extra VALUES (\'extra\',\'retained\')'); extra.close();
    const destination = join(f.root, 'snapshot'); await exportMigrationSnapshot({ ...f, destination, sourceQuiesced: false });
    const path = join(destination, 'manifest.json'), manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.databases = manifest.databases.filter((item: { path: string }) => item.path !== 'additional.sqlite'); writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => validateMigrationSnapshot(destination), /MIGRATION_DATABASE_SET_MISMATCH/);
  } finally { f.close(); }
});

test('registry cannot be accidentally included inside product source data', async () => {
  const f = fixture();
  try {
    const registryPath = join(f.source, 'private-feedback-state.json'); writeFileSync(registryPath, JSON.stringify(f.registry));
    await assert.rejects(exportMigrationSnapshot({ ...f, registryPath, destination: join(f.root, 'snapshot'), sourceQuiesced: false }), /MIGRATION_REGISTRY_INSIDE_SOURCE/);
  } finally { f.close(); }
});

test('overlap and links fail closed without publishing or touching input', async () => {
  const f = fixture();
  try {
    await assert.rejects(exportMigrationSnapshot({ ...f, destination: join(f.source, 'nested'), sourceQuiesced: false }), /MIGRATION_INPUT_OVERLAP/);
    await assert.rejects(exportMigrationSnapshot({ ...f, destination: join(f.root, 'excluded'), sourceQuiesced: false, excludePaths: ['business.sqlite'] }), /MIGRATION_REQUIRED_INPUT_EXCLUDED/);
    await assert.rejects(exportMigrationSnapshot({ ...f, destination: join(f.root, 'excluded-wal'), sourceQuiesced: false, excludePaths: ['business.sqlite-wal'] }), /MIGRATION_EXCLUSION_FORBIDDEN/);
    const link = join(f.source, 'linked-files'); symlinkSync(join(f.source, 'files'), link, process.platform === 'win32' ? 'junction' : 'dir');
    const destination = join(f.root, 'linked-snapshot');
    await assert.rejects(exportMigrationSnapshot({ ...f, destination, sourceQuiesced: false }), /MIGRATION_LINK_FORBIDDEN/);
    assert.equal(existsSync(destination), false);
  } finally { f.close(); }
});

test('privacy replay removes latest deleted derivations and pending capture resumes only once', async () => {
  const f = fixture();
  try {
    f.put('source-pending', 'source', { origin: 'user', text: '建议新增合成检验入口' });
    f.put('job-pending', 'job', { sourceId: 'source-pending', type: 'capture', status: 'pending', attempts: 0 });
    f.put('source-erased', 'source', { origin: 'user', text: 'Synthetic erased source' });
    f.put('feedback-erased', 'feedback', { text: 'Erased derivative', sources: ['source-erased'], status: 'captured' });
    writeFileSync(join(f.source, 'privacy-ledger.jsonl'), JSON.stringify({ scope: 'main', id: 'source-erased', action: 'delete', at: '2026-06-01T00:00:00Z' }) + '\n');
    f.close(); const snapshot = join(f.root, 'final'), destination = join(f.root, 'candidate');
    await exportMigrationSnapshot({ ...f, destination: snapshot, sourceQuiesced: true });
    const snapshotBefore = tree(snapshot); await stageMigration({ snapshot, destination }); assert.deepEqual(tree(snapshot), snapshotBefore);
    const business = new Business(join(destination, 'data'));
    try {
      assert.equal(business.store.isDeleted('main', 'feedback-erased'), true);
      assert.throws(() => business.store.get('main', 'source-erased'), /NOT_FOUND/);
      assert.equal(business.store.get<{ status: string } & import('../../packages/business/core/store.ts').Base>('main', 'job-pending').status, 'pending');
      business.tick('main');
      const once = business.store.list('main', 'feedback'); business.tick('main');
      assert.deepEqual(business.store.list('main', 'feedback'), once);
      assert.equal(once.filter(item => (item as unknown as { sources: string[] }).sources.includes('source-pending')).length, 1);
      assert.equal(business.store.get<{ status: string; attempts: number } & import('../../packages/business/core/store.ts').Base>('main', 'job-pending').attempts, 1);
    } finally { business.close(); }
  } finally { try { f.close(); } catch {} }
});

test('malformed native owner prevents publication and interrupted destination can be retried', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.source, 'superagent')); const db = new DatabaseSync(join(f.source, 'superagent', 'orchestrator.sqlite'));
    db.exec('CREATE TABLE fake(id INTEGER)'); db.close(); f.close();
    const snapshot = join(f.root, 'bad-native'), destination = join(f.root, 'candidate');
    await exportMigrationSnapshot({ ...f, destination: snapshot, sourceQuiesced: true });
    await assert.rejects(stageMigration({ snapshot, destination }), /MIGRATION_NATIVE_STATE_INVALID/);
    assert.equal(existsSync(destination), false); assert.equal(readdirSync(f.root).some(name => name.startsWith('.amazonops-migration-')), false);
    rmSync(join(f.source, 'superagent'), { recursive: true });
    const valid = join(f.root, 'valid'); await exportMigrationSnapshot({ ...f, destination: valid, sourceQuiesced: true });
    await stageMigration({ snapshot: valid, destination }); assert.equal(existsSync(join(destination, 'data', 'business.sqlite')), true);
  } finally { try { f.close(); } catch {} }
});

test('CLI emits only aggregate results and refuses repository output', async () => {
  const f = fixture();
  try {
    f.close(); const snapshot = join(f.root, 'snapshot');
    const run = (args: string[]) => spawnSync(process.execPath, ['--experimental-transform-types', 'scripts/migration.ts', ...args], { encoding: 'utf8', windowsHide: true });
    const result = run(['export', '--source', f.source, '--destination', snapshot, '--registry', f.registryPath, '--source-quiesced', 'true']);
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).sourceQuiesced, true);
    assert.equal(result.stdout.includes('feedback-a'), false); assert.equal(result.stdout.includes('Synthetic'), false);
    const compared = run(['compare', '--before', snapshot, '--after', snapshot]); assert.equal(compared.status, 0, compared.stderr); assert.equal(JSON.parse(compared.stdout).equal, true);
    const denied = run(['export', '--source', f.source, '--destination', 'private-runtime', '--registry', f.registryPath, '--source-quiesced', 'false']);
    assert.equal(denied.status, 1); assert.equal(JSON.parse(denied.stderr.trim().split('\n').at(-1)!).error, 'MIGRATION_OUTPUT_INSIDE_REPOSITORY');
  } finally { try { f.close(); } catch {} }
});
