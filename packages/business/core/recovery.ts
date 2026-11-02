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
  if (existsSync(destination) && readdirSync(destination).length)
    throw new Error('RESTORE_TARGET_NOT_EMPTY');
  if (!existsSync(currentLedger)) throw new Error('CURRENT_PRIVACY_LEDGER_REQUIRED');
  if (!currentBudget || !existsSync(currentBudget))
    throw new Error('CURRENT_MODEL_BUDGET_REQUIRED');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as Manifest;
  if (manifest.schemaVersion !== '1.0' || !Array.isArray(manifest.files))
    throw new Error('INVALID_BACKUP_MANIFEST');
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    if (!path.startsWith(root + '/') && !path.startsWith(root + '\\'))
      throw new Error('BACKUP_PATH_FORBIDDEN');
    const bytes = readFileSync(path);
    if (
      bytes.length !== file.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw new Error('BACKUP_HASH_MISMATCH');
  }
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const path = join(destination, file.path);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(join(root, file.path), path);
  }
  copyFileSync(currentLedger, join(destination, 'privacy-ledger.jsonl'));
  // Restoring business data must never refund attempts or uncertain usage.
  const current = new DatabaseSync(currentBudget, { readOnly: true });
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
    merged.exec('COMMIT');
  } catch (error) {
    merged.exec('ROLLBACK');
    throw error;
  } finally {
    current.close();
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
