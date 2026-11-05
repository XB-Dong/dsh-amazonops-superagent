/** Final publish preserves the original snapshot and keeps private maintenance outside product data. */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyInventory, directory, emptyDestination, inventory, removeStage, unlinked, hash } from './migration-files.ts';
import { databaseState, compareStates } from './migration-state.ts';
import { validateMigrationSnapshot } from './migration.ts';
import { Store } from './store.ts';
import { ensureBudgetSchema } from './budget.ts';

type StageOptions = { snapshot: string; destination: string; requireFinal?: boolean };
export async function stageMigration(options: StageOptions) {
  const snapshot = directory(options.snapshot), manifest = validateMigrationSnapshot(snapshot);
  if (options.requireFinal !== false && !manifest.sourceQuiesced) throw new Error('MIGRATION_SOURCE_NOT_QUIESCED');
  const destination = emptyDestination(snapshot, options.destination), parent = dirname(destination);
  unlinked(parent); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, '.amazonops-migration-')); let published = false;
  try {
    copyInventory(snapshot, stage, manifest.files);
    const data = join(stage, 'data');
    const before = databaseState(join(data, 'business.sqlite'), 'business.sqlite');
    const beforeBudget = databaseState(join(data, 'model-budget.sqlite'), 'model-budget.sqlite');
    if (JSON.stringify(before) !== JSON.stringify(manifest.databases.find(db => db.path === 'business.sqlite')) ||
      JSON.stringify(beforeBudget) !== JSON.stringify(manifest.databases.find(db => db.path === 'model-budget.sqlite')))
      throw new Error('MIGRATION_DATABASE_SET_MISMATCH');
    // Fresh target only: request primary keys are preserved, never upserted over another ledger.
    // Preserve the immutable old database as well as the upgraded active ledger.
    copyFileSync(join(data, 'model-budget.sqlite'), join(stage, 'maintenance', 'legacy-model-budget.sqlite'));
    const budget = new DatabaseSync(join(data, 'model-budget.sqlite'));
    try { ensureBudgetSchema(budget); }
    finally { budget.close(); }
    const store = new Store(join(data, 'business.sqlite'));
    try {
      if (store.db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('MIGRATION_DATABASE_INVALID');
    } finally { store.close(); }
    const after = databaseState(join(data, 'business.sqlite'), 'business.sqlite');
    const changes = compareStates([before], [after]);
    if (existsSync(join(data, 'harness')) || existsSync(join(data, 'superagent'))) {
      const validator = fileURLToPath(new URL('../../../scripts/validate-native-recovery.mjs', import.meta.url));
      const checked = spawnSync(process.execPath, [validator, data], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      if (checked.status !== 0 || checked.error) throw new Error('MIGRATION_NATIVE_STATE_INVALID');
    }
    const state = JSON.parse(readFileSync(join(stage, 'maintenance', 'feedback-state.json'), 'utf8')) as { feedbackRevisions: { id: string; revision?: number; decision?: string }[] };
    const mapping = { schemaVersion: '1.0', source: 'legacy-ccagent', target: 'amazonops',
      feedback: state.feedbackRevisions.map(row => ({ sourceId: row.id, targetId: row.id, revision: row.revision, decision: row.decision })),
      budgetIdentity: 'preserved_in_fresh_database_primary_key_collision_fails',
      oldBudgetArchiveSha256: hash(readFileSync(join(stage, 'maintenance', 'legacy-model-budget.sqlite'))) };
    writeFileSync(join(stage, 'maintenance', 'migration-mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
    const receipt = { schemaVersion: 'amazonops-migration-receipt/1', createdAt: new Date().toISOString(), sourceQuiesced: manifest.sourceQuiesced,
      sourceManifestSha256: hash(readFileSync(join(snapshot, 'manifest.json'))), dataDirectory: 'data', registry: 'maintenance/feedback-state.json',
      registryPreserved: true, privacyLedgerReapplied: true, projectionChanges: changes, files: inventory(stage) };
    writeFileSync(join(stage, 'migration-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    unlinked(destination); if (existsSync(destination)) rmdirSync(destination);
    renameSync(stage, destination); published = true;
    return { ok: true, final: manifest.sourceQuiesced, files: receipt.files.length, dataDirectory: join(destination, 'data'),
      registryPath: join(destination, 'maintenance', 'feedback-state.json'), projectionChanges: changes };
  } finally { if (!published) removeStage(stage, parent); }
}
