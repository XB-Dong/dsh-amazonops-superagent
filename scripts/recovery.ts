/** Offline restore/migration: inputs stay read-only; publish only a validated new data directory. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { restoreRecoveryPoint } from '../packages/business/core/recovery.ts';

type Options = { backup: string; destination: string; current: string };
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function physical(path: string): string {
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('INVALID_RESTORE_PATH');
    ancestor = parent;
  }
  return resolve(realpathSync(ancestor), relative(ancestor, resolve(path)));
}
function regular(root: string, file: string): void {
  if (!within(root, file)) throw new Error('BACKUP_PATH_FORBIDDEN');
  let path = root;
  for (const component of relative(root, file).split(sep)) {
    path = join(path, component);
    if (lstatSync(path).isSymbolicLink()) throw new Error('BACKUP_SYMLINK_FORBIDDEN');
  }
  if (!lstatSync(file).isFile()) throw new Error('BACKUP_FILE_REQUIRED');
}
export function restoreLocal(options: Options) {
  const backup = realpathSync(resolve(options.backup)), current = realpathSync(resolve(options.current));
  const destination = physical(options.destination);
  if ([backup, current].some(input => within(input, destination) || within(destination, input))) throw new Error('RESTORE_INPUT_OVERLAP');
  if (existsSync(destination) && (lstatSync(destination).isSymbolicLink() || !lstatSync(destination).isDirectory() || readdirSync(destination).length)) throw new Error('RESTORE_TARGET_NOT_EMPTY');
  const ledger = join(current, 'privacy-ledger.jsonl'), budget = join(current, 'model-budget.sqlite');
  regular(current, ledger); regular(current, budget); regular(backup, join(backup, 'manifest.json'));
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== '1.0' || !Array.isArray(manifest.files)) throw new Error('INVALID_BACKUP_MANIFEST');
  const names = new Set<string>();
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || !item.path || isAbsolute(item.path) || /^[A-Za-z]:/.test(item.path)
      || item.path.includes('\\') || item.path.split('/').some((part: string) => !part || part === '.' || part === '..')
      || /[\x00-\x1f]/.test(item.path) || names.has(item.path)) throw new Error('BACKUP_PATH_FORBIDDEN');
    names.add(item.path);
    const path = resolve(backup, item.path); regular(backup, path);
    const bytes = readFileSync(path);
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('BACKUP_HASH_MISMATCH');
  }
  if (!names.has('business.sqlite') || !names.has('model-budget.sqlite')) throw new Error('BACKUP_DATABASE_REQUIRED');
  const parent = dirname(destination); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, '.amazonops-restore-'));
  let published = false;
  try {
    const result = restoreRecoveryPoint(backup, stage, ledger, budget);
    const db = new DatabaseSync(join(stage, 'business.sqlite'), { readOnly: true });
    let entities: number, entityDigest: string;
    try {
      const rows = db.prepare('SELECT scope,kind,id,revision,payload FROM entities ORDER BY scope,id').all();
      entities = rows.length;
      entityDigest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    } finally { db.close(); }
    const usage = new DatabaseSync(join(stage, 'model-budget.sqlite'), { readOnly: true });
    let modelRequests: number;
    try { modelRequests = Number(usage.prepare('SELECT COUNT(*) AS n FROM model_requests').get()?.n); }
    finally { usage.close(); }
    if (existsSync(destination)) rmdirSync(destination);
    renameSync(stage, destination); published = true;
    return { ok: true, files: result.files, entities, entityDigest, modelRequests, privacyLedgerReapplied: true };
  } finally {
    // Stage is a known direct child of the explicit destination parent, never an input directory.
    if (!published && dirname(resolve(stage)) === resolve(parent) && stage.startsWith(join(parent, '.amazonops-restore-'))) rmSync(stage, { recursive: true, force: true });
  }
}
export function parseRecoveryArguments(args: string[]): Options {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--backup', '--destination', '--current'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_RECOVERY_ARGUMENTS');
    options[key] = args[i + 1];
  }
  if (Object.keys(options).length !== 3) throw new Error('INVALID_RECOVERY_ARGUMENTS');
  return { backup: options['--backup'], destination: options['--destination'], current: options['--current'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(restoreLocal(parseRecoveryArguments(process.argv.slice(2))))); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : 'LOCAL_RESTORE_FAILED';
    console.error(JSON.stringify({ ok: false, error: code })); process.exitCode = 1;
  }
}
