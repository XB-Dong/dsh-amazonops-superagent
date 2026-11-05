/** Private migration CLI. Detailed manifests and row identities never go to stdout. */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportMigrationSnapshot, validateMigrationSnapshot, compareMigrationSnapshots, stageMigration } from '../packages/business/core/migration.ts';
import { inside, unlinked } from '../packages/business/core/migration-files.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function privatePath(path: string): string {
  const target = resolve(path); unlinked(target);
  if (inside(root, target)) throw new Error('MIGRATION_OUTPUT_INSIDE_REPOSITORY');
  return target;
}
function parse(args: string[]): { action: string; values: Record<string, string> } {
  const [action, ...fields] = args;
  const allowed: Record<string, string[]> = { export: ['source', 'destination', 'registry', 'source-quiesced'],
    validate: ['snapshot'], compare: ['before', 'after', 'report'], stage: ['snapshot', 'destination', 'require-final'] };
  if (!Object.hasOwn(allowed, action)) throw new Error('MIGRATION_ARGUMENTS_INVALID');
  const values: Record<string, string> = {};
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index]?.slice(2), value = fields[index + 1];
    if (!fields[index]?.startsWith('--') || !allowed[action].includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--'))
      throw new Error('MIGRATION_ARGUMENTS_INVALID');
    values[key] = value;
  }
  const optional = ['report', 'require-final'];
  if (allowed[action].filter(key => !optional.includes(key)).some(key => !values[key])) throw new Error('MIGRATION_ARGUMENTS_INVALID');
  return { action, values };
}
function boolean(value: string): boolean {
  if (!['true', 'false'].includes(value)) throw new Error('MIGRATION_ARGUMENTS_INVALID');
  return value === 'true';
}
export async function runMigration(args: string[]) {
  const { action, values: v } = parse(args);
  if (action === 'export') {
    const manifest = await exportMigrationSnapshot({ source: v.source, destination: privatePath(v.destination), registryPath: v.registry,
      sourceQuiesced: boolean(v['source-quiesced']) });
    return { ok: true, sourceQuiesced: manifest.sourceQuiesced, consistency: manifest.consistency, files: manifest.files.length,
      databases: manifest.databases.length, registryIncluded: true, excludedPaths: manifest.excludedPaths };
  }
  if (action === 'validate') {
    const manifest = validateMigrationSnapshot(v.snapshot);
    return { ok: true, sourceQuiesced: manifest.sourceQuiesced, files: manifest.files.length, databases: manifest.databases.length };
  }
  if (action === 'compare') {
    const diff = compareMigrationSnapshots(v.before, v.after);
    if (v.report) writeFileSync(privatePath(v.report), `${JSON.stringify(diff, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { ok: true, equal: diff.equal, added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length,
      changedSchemas: diff.schemas.length, changedFiles: diff.files.length, registryChanged: diff.registryChanged };
  }
  const result = await stageMigration({ snapshot: v.snapshot, destination: privatePath(v.destination), requireFinal: v['require-final'] === undefined ? true : boolean(v['require-final']) });
  return { ok: true, final: result.final, files: result.files, registryPreserved: true, privacyLedgerReapplied: true,
    projectionAdded: result.projectionChanges.added.length, projectionRemoved: result.projectionChanges.removed.length,
    projectionChanged: result.projectionChanges.changed.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runMigration(process.argv.slice(2)))); }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'MIGRATION_FAILED';
    console.error(JSON.stringify({ ok: false, error: code })); process.exitCode = 1;
  }
}
