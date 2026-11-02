import { backup, DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  statSync,
  lstatSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from './store.ts';
import type { ModelBudget } from './budget.ts';
import { ensureBudgetSchema } from './budget.ts';

type Manifest = {
  schemaVersion: string;
  createdAt: string;
  harnessVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
};
function noLinks(path:string):void {
  let current=resolve(path);
  for(;;){
    if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('BACKUP_SYMLINK_FORBIDDEN');
    const parent=dirname(current);if(parent===current)return;current=parent;
  }
}
function inventory(root: string, directory = root): Manifest['files'] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('BACKUP_SYMLINK_FORBIDDEN');
    if (entry.isDirectory()) return inventory(root, path);
    const bytes = readFileSync(path);
    return [
      {
        path: relative(root, path).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ];
  });
}

function mergeAttribution(current: DatabaseSync, merged: DatabaseSync): void {
  if (!current.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_request_attribution'").get()) return;
  merged.exec(`CREATE TABLE IF NOT EXISTS model_request_attribution (
    request_id TEXT PRIMARY KEY, session_id TEXT, turn_seq INTEGER,
    purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL
  );`);
  const columns = 'request_id,session_id,turn_seq,purpose,provider,model';
  for (const row of current.prepare(`SELECT ${columns} FROM model_request_attribution`).all()) {
    if (!merged.prepare('SELECT id FROM model_requests WHERE id=?').get(row.request_id))
      throw new Error('MODEL_ATTRIBUTION_ORPHAN');
    const previous = merged.prepare(`SELECT ${columns} FROM model_request_attribution WHERE request_id=?`).get(row.request_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('MODEL_ATTRIBUTION_CONFLICT');
    if (!previous) merged.prepare('INSERT INTO model_request_attribution VALUES (?,?,?,?,?,?)')
      .run(row.request_id, row.session_id, row.turn_seq, row.purpose, row.provider, row.model);
  }
}
export async function createRecoveryPoint(
  store: Store,
  budget: ModelBudget,
  dataDir: string,
  backupRoot: string,
) {
  const directory = join(
    backupRoot,
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  await backup(store.db, join(directory, 'business.sqlite'));
  await backup(budget.db, join(directory, 'model-budget.sqlite'));
  // Caller has paused/flushed the native Runtime; preserve its separate state owner as well.
  for (const name of ['harness', 'superagent', 'files', 'exports'])
    if (existsSync(join(dataDir, name)))
      cpSync(join(dataDir, name), join(directory, name), { recursive: true, dereference: false });
  writeFileSync(
    join(directory, 'privacy-ledger.jsonl'),
    existsSync(store.ledgerPath) ? readFileSync(store.ledgerPath) : '',
    { mode: 0o600 },
  );
  const manifest: Manifest = {
    schemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    harnessVersion: '0.2.1-rc.3',
    files: inventory(directory),
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return { directory, manifest };
}
export function restoreRecoveryPoint(
  directory: string,
  target: string,
  currentLedger: string,
  currentBudget?: string,
) {
  const root = resolve(directory);
  const destination = resolve(target);
  noLinks(root);noLinks(destination);noLinks(currentLedger);
  if(currentBudget)noLinks(currentBudget);
  if (existsSync(destination) && readdirSync(destination).length)
    throw new Error('RESTORE_TARGET_NOT_EMPTY');
  if (!existsSync(currentLedger)) throw new Error('CURRENT_PRIVACY_LEDGER_REQUIRED');
  if (!currentBudget || !existsSync(currentBudget))
    throw new Error('CURRENT_MODEL_BUDGET_REQUIRED');
  noLinks(join(root,'manifest.json'));
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as Manifest;
  if (manifest.schemaVersion !== '1.0' || !Array.isArray(manifest.files))
    throw new Error('INVALID_BACKUP_MANIFEST');
  const names=new Set<string>();
  for (const file of manifest.files) {
    if(typeof file.path!=='string'||!file.path||file.path.includes('\\')||file.path.includes(':')||
      file.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f]/.test(file.path)||names.has(file.path.toLowerCase()))
      throw new Error('BACKUP_PATH_FORBIDDEN');
    names.add(file.path.toLowerCase());
    const path = resolve(root, file.path);
    if (!path.startsWith(root + '/') && !path.startsWith(root + '\\'))
      throw new Error('BACKUP_PATH_FORBIDDEN');
    noLinks(path);
    if(!lstatSync(path).isFile())throw new Error('BACKUP_FILE_REQUIRED');
    const bytes = readFileSync(path);
    if (
      bytes.length !== file.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw new Error('BACKUP_HASH_MISMATCH');
  }
  if(!names.has('business.sqlite')||!names.has('model-budget.sqlite'))throw new Error('BACKUP_DATABASE_REQUIRED');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const path = join(destination, file.path);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(join(root, file.path), path);
  }
  copyFileSync(currentLedger, join(destination, 'privacy-ledger.jsonl'));
  // Restoring business data must never refund attempts or uncertain usage.
  // SQLite readOnly may create WAL/SHM and modify read marks in the input tree.
  // Read a private db+WAL copy instead; never use immutable on a nonempty WAL,
  // which would silently discard later charged requests. The CLI is offline:
  // callers must stop source owners before recovery, not use this as hot backup.
  const scratch = mkdtempSync(join(destination, '.current-budget-'));
  let current: DatabaseSync | undefined;
  try {
    const copiedBudget = join(scratch, 'model-budget.sqlite');
    for (const suffix of ['', '-wal']) {
      const input = `${currentBudget}${suffix}`;
      noLinks(input);
      if (existsSync(input)) {
        if (!lstatSync(input).isFile()) throw new Error('CURRENT_MODEL_BUDGET_FILE_REQUIRED');
        copyFileSync(input, `${copiedBudget}${suffix}`);
      }
    }
    current = new DatabaseSync(copiedBudget);
    if (current.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new Error('CURRENT_MODEL_BUDGET_INVALID');
    return mergeCurrentBudget(current);
  } finally {
    current?.close();
    if (dirname(resolve(scratch)) !== destination) throw new Error('RESTORE_SCRATCH_PATH_FORBIDDEN');
    noLinks(scratch);
    rmSync(scratch, { recursive: true, force: true });
  }
  function mergeCurrentBudget(current: DatabaseSync) {
  const merged = new DatabaseSync(join(destination, 'model-budget.sqlite'));
  try {
    ensureBudgetSchema(merged);
    merged.exec('BEGIN IMMEDIATE');
    for (const row of current.prepare('SELECT * FROM model_requests').all()) {
      merged
        .prepare(
          `INSERT INTO model_requests (id,input_tokens,output_tokens,settled,usage_verified,created_at,budget_account) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET input_tokens=MAX(input_tokens,excluded.input_tokens),output_tokens=MAX(output_tokens,excluded.output_tokens),settled=MAX(settled,excluded.settled),usage_verified=MIN(usage_verified,excluded.usage_verified)`,
        )
        .run(
          row.id,
          row.input_tokens,
          row.output_tokens,
          row.settled,
          row.usage_verified,
          row.created_at,
          row.budget_account ?? 'legacy',
        );
    }
    // Attribution is immutable audit state and follows request rows, never a refunded snapshot.
    mergeAttribution(current, merged);
    merged.exec('COMMIT');
  } catch (error) {
    merged.exec('ROLLBACK');
    throw error;
  } finally {
    merged.close();
  }
  const restored = new Store(join(destination, 'business.sqlite'));
  try {
    if (restored.db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new Error('RESTORE_INTEGRITY_FAILED');
    return { target: destination, files: manifest.files.length, privacyLedgerReapplied: true };
  } finally {
    restored.close();
  }
  }
}
