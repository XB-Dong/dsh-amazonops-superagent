import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, hash, noLinks, physical } from './files.ts';

export type Item = { id: string; kind: string; revision?: number; status?: string; fingerprint: string };
export type InspectionSnapshot = { feedback: Item[]; pendingCapture: Item[]; tombstones: Item[]; privacyLedgerSha256: string | null };
function sourceFiles(data: string) {
  return ['business.sqlite', 'business.sqlite-wal', 'business.sqlite-shm', 'privacy-ledger.jsonl'].flatMap(name => {
    const path = join(data, name); noLinks(path);
    if (!existsSync(path)) return [];
    if (!lstatSync(path).isFile()) throw new Error('MAINTENANCE_INPUT_INVALID');
    const bytes = readFileSync(path); return [{ name, bytes: bytes.length, fingerprint: hash(bytes) }];
  });
}
export function inspectData(directory: string): { snapshot: InspectionSnapshot; sourceIdentity: string } {
  const data = physical(directory);
  if (!existsSync(data) || !lstatSync(data).isDirectory()) throw new Error('MAINTENANCE_INPUT_INVALID');
  const before = sourceFiles(data);
  if (!before.some(row => row.name === 'business.sqlite')) throw new Error('MAINTENANCE_DATABASE_REQUIRED');
  const scratch = mkdtempSync(join(tmpdir(), 'amazonops-maintenance-read-'));
  let db: DatabaseSync | undefined;
  try {
    // SQLite readOnly can alter source sidecars. Only open a private db+WAL copy.
    for (const row of before.filter(row => row.name === 'business.sqlite' || row.name === 'business.sqlite-wal'))
      copyFileSync(join(data, row.name), join(scratch, row.name));
    if (canonical(sourceFiles(data)) !== canonical(before)) throw new Error('MAINTENANCE_SOURCE_CHANGED');
    db = new DatabaseSync(join(scratch, 'business.sqlite'));
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('MAINTENANCE_DATABASE_INVALID');
    const snapshot: InspectionSnapshot = { feedback: [], pendingCapture: [], tombstones: [],
      privacyLedgerSha256: before.find(row => row.name === 'privacy-ledger.jsonl')?.fingerprint ?? null };
    const rows = db.prepare("SELECT scope,kind,id,revision,payload FROM entities WHERE scope='main' AND kind IN ('feedback','source','job') ORDER BY kind,id").all();
    const pendingJobs = new Set<string>(), pendingSources = new Set<string>();
    for (const row of rows.filter(row => row.kind === 'job')) {
      const payload = JSON.parse(String(row.payload));
      if (payload.type === 'capture' && ['pending', 'running', 'retrying'].includes(payload.status)) {
        pendingJobs.add(String(row.id));
        if (typeof payload.sourceId === 'string') pendingSources.add(payload.sourceId);
      }
    }
    for (const row of rows) {
      const payload = JSON.parse(String(row.payload));
      if (!payload || payload.scope !== row.scope || payload.kind !== row.kind || payload.id !== row.id || payload.revision !== row.revision)
        throw new Error('MAINTENANCE_ENTITY_INVALID');
      const item: Item = { id: String(row.id), kind: String(row.kind), revision: Number(row.revision),
        ...(typeof payload.status === 'string' ? { status: payload.status } : {}), fingerprint: hash(canonical(payload)) };
      if (row.kind === 'feedback') snapshot.feedback.push(item);
      else if ((row.kind === 'source' && pendingSources.has(item.id)) || (row.kind === 'job' && pendingJobs.has(item.id)))
        snapshot.pendingCapture.push(item);
    }
    snapshot.tombstones = db.prepare("SELECT id,deleted_at FROM tombstones WHERE scope='main' ORDER BY id").all()
      .map(row => ({ id: String(row.id), kind: 'tombstone', fingerprint: hash(canonical(row)) }));
    if (canonical(sourceFiles(data)) !== canonical(before)) throw new Error('MAINTENANCE_SOURCE_CHANGED');
    return { snapshot, sourceIdentity: hash(data) };
  } catch (error) {
    if (error instanceof Error && /^MAINTENANCE_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error('MAINTENANCE_DATABASE_INVALID');
  } finally {
    db?.close();
    const checked = realpathSync.native(scratch), parent = realpathSync.native(tmpdir());
    if (dirname(checked) !== parent || !basename(checked).startsWith('amazonops-maintenance-read-') || resolve(scratch) === parent)
      throw new Error('MAINTENANCE_SCRATCH_PATH_FORBIDDEN');
    noLinks(scratch); rmSync(scratch, { recursive: true, force: true });
  }
}
