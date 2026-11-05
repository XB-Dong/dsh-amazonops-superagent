/** A stable private copy is a rehearsal until the operator has fenced all source owners. */
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { copyInventory, directory, emptyDestination, hash, inside, inventory, physical, removeStage, safeName, unlinked, type FileRecord } from './migration-files.ts';
import { compareStates, databaseState, sqliteFile, statesAt, type DatabaseRecord, type MigrationDifference } from './migration-state.ts';
export { stageMigration } from './migration-stage.ts';

export type MigrationManifest = {
  schemaVersion: 'amazonops-migration/1'; capturedAt: string; sourceQuiesced: boolean;
  consistency: 'operator_fenced_stable_copy' | 'rehearsal_stable_copy'; excludedPaths: string[];
  files: FileRecord[]; databases: DatabaseRecord[]; registrySha256: string;
};
export type ExportMigrationOptions = { source: string; destination: string; registryPath: string; sourceQuiesced: boolean; excludePaths?: string[] };
function registry(path: string): Buffer {
  unlinked(path);
  const bytes = readFileSync(path), value = JSON.parse(bytes.toString('utf8'));
  if (!value || !Array.isArray(value.feedbackRevisions) || value.feedbackRevisions.some((row: unknown) =>
    !row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string')) throw new Error('MIGRATION_REGISTRY_INVALID');
  return bytes;
}
function finalize(stage: string, destination: string): void {
  unlinked(destination);
  if (existsSync(destination)) rmdirSync(destination);
  renameSync(stage, destination);
}
export async function exportMigrationSnapshot(options: ExportMigrationOptions): Promise<MigrationManifest> {
  if (typeof options.sourceQuiesced !== 'boolean') throw new Error('MIGRATION_FENCE_ATTESTATION_REQUIRED');
  const source = directory(options.source), destination = emptyDestination(source, options.destination);
  unlinked(options.registryPath);
  if (inside(source, physical(options.registryPath))) throw new Error('MIGRATION_REGISTRY_INSIDE_SOURCE');
  if (inside(destination, physical(options.registryPath))) throw new Error('MIGRATION_INPUT_OVERLAP');
  const excludePaths = options.excludePaths ?? ['backups'];
  for (const item of excludePaths) {
    safeName(item);
    if (['business.sqlite', 'model-budget.sqlite', 'privacy-ledger.jsonl'].some(name => item === name || name.startsWith(`${item}/`)))
      throw new Error('MIGRATION_REQUIRED_INPUT_EXCLUDED');
    if (item !== 'backups') throw new Error('MIGRATION_EXCLUSION_FORBIDDEN');
  }
  const original = inventory(source, excludePaths), registryBytes = registry(options.registryPath);
  if (['business.sqlite', 'model-budget.sqlite', 'privacy-ledger.jsonl'].some(name => !original.some(row => row.path === name)))
    throw new Error('MIGRATION_REQUIRED_INPUT_MISSING');
  const parent = dirname(destination); unlinked(parent); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, '.amazonops-migration-')); let published = false;
  try {
    const capture = join(stage, '.capture'), data = join(stage, 'data'); mkdirSync(capture); mkdirSync(data);
    copyInventory(source, capture, original);
    if (JSON.stringify(inventory(source, excludePaths)) !== JSON.stringify(original) || !registry(options.registryPath).equals(registryBytes))
      throw new Error('MIGRATION_SOURCE_CHANGED');
    const databases = original.filter(item => sqliteFile(join(capture, item.path))).map(item => item.path);
    if (!databases.includes('business.sqlite') || !databases.includes('model-budget.sqlite')) throw new Error('MIGRATION_DATABASE_INVALID');
    const sidecar = (name: string) => databases.some(db => name === `${db}-wal` || name === `${db}-shm` || name === `${db}-journal`);
    copyInventory(capture, data, original.filter(item => !databases.includes(item.path) && !sidecar(item.path)));
    for (const name of databases) {
      const output = join(data, name); mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      // Only the private copied database is opened: source WAL/SHM read marks stay untouched.
      const copied = new DatabaseSync(join(capture, name));
      try {
        if (copied.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('MIGRATION_DATABASE_INVALID');
        await backup(copied, output);
      } finally { copied.close(); }
      const canonical = new DatabaseSync(output);
      try { canonical.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;'); }
      finally { canonical.close(); }
    }
    rmSync(capture, { recursive: true });
    mkdirSync(join(stage, 'maintenance'), { mode: 0o700 });
    writeFileSync(join(stage, 'maintenance', 'feedback-state.json'), registryBytes, { mode: 0o600 });
    const manifest: MigrationManifest = { schemaVersion: 'amazonops-migration/1', capturedAt: new Date().toISOString(),
      sourceQuiesced: options.sourceQuiesced, consistency: options.sourceQuiesced ? 'operator_fenced_stable_copy' : 'rehearsal_stable_copy',
      excludedPaths: excludePaths, files: inventory(stage), databases: statesAt(data, databases), registrySha256: hash(registryBytes) };
    writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    validateMigrationSnapshot(stage); finalize(stage, destination); published = true; return manifest;
  } finally { if (!published) removeStage(stage, parent); }
}
export function validateMigrationSnapshot(snapshot: string): MigrationManifest {
  const root = directory(snapshot); unlinked(join(root, 'manifest.json'));
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as MigrationManifest;
  if (manifest.schemaVersion !== 'amazonops-migration/1' || typeof manifest.sourceQuiesced !== 'boolean' ||
    manifest.consistency !== (manifest.sourceQuiesced ? 'operator_fenced_stable_copy' : 'rehearsal_stable_copy') ||
    !Array.isArray(manifest.files) || !Array.isArray(manifest.databases)) throw new Error('MIGRATION_MANIFEST_INVALID');
  const names = new Set<string>();
  for (const item of manifest.files) {
    safeName(item.path);
    if (names.has(item.path.toLowerCase()) || item.path === 'manifest.json') throw new Error('MIGRATION_MANIFEST_INVALID');
    names.add(item.path.toLowerCase());
  }
  const actual = inventory(root, ['manifest.json']);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('MIGRATION_HASH_OR_SET_MISMATCH');
  if (['data/business.sqlite', 'data/model-budget.sqlite', 'data/privacy-ledger.jsonl', 'maintenance/feedback-state.json'].some(name => !names.has(name)))
    throw new Error('MIGRATION_REQUIRED_INPUT_MISSING');
  if (hash(registry(join(root, 'maintenance', 'feedback-state.json'))) !== manifest.registrySha256) throw new Error('MIGRATION_REGISTRY_MISMATCH');
  const dbNames = new Set<string>();
  for (const db of manifest.databases) {
    safeName(db.path);
    if (dbNames.has(db.path.toLowerCase()) || !names.has(`data/${db.path}`.toLowerCase())) throw new Error('MIGRATION_MANIFEST_INVALID');
    dbNames.add(db.path.toLowerCase());
    if (JSON.stringify(databaseState(join(root, 'data', db.path), db.path)) !== JSON.stringify(db)) throw new Error('MIGRATION_DATABASE_SET_MISMATCH');
  }
  const physicalDatabases = actual.filter(item => item.path.startsWith('data/') && sqliteFile(join(root, item.path))).map(item => item.path.slice(5).toLowerCase());
  if (physicalDatabases.length !== dbNames.size || physicalDatabases.some(name => !dbNames.has(name)))
    throw new Error('MIGRATION_DATABASE_SET_MISMATCH');
  if (!dbNames.has('business.sqlite') || !dbNames.has('model-budget.sqlite')) throw new Error('MIGRATION_DATABASE_INVALID');
  return manifest;
}
export function compareMigrationSnapshots(before: string, after: string): MigrationDifference {
  const a = validateMigrationSnapshot(before), b = validateMigrationSnapshot(after);
  const rows = compareStates(a.databases, b.databases), databaseNames = new Set([...a.databases, ...b.databases].map(item => `data/${item.path}`));
  const files = (manifest: MigrationManifest) => new Map(manifest.files.filter(item => !databaseNames.has(item.path) && item.path !== 'maintenance/feedback-state.json').map(item => [item.path, item.sha256]));
  const oldFiles = files(a), newFiles = files(b);
  const changedFiles = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(path => oldFiles.get(path) !== newFiles.get(path));
  const registryChanged = a.registrySha256 !== b.registrySha256;
  return { ...rows, files: changedFiles, registryChanged,
    equal: ![...rows.added, ...rows.removed, ...rows.changed, ...rows.schemas, ...changedFiles].length && !registryChanged };
}
