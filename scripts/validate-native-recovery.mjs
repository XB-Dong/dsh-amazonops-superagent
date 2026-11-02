/** Read-only owner validation before a recovery staging directory is published. */
import { Context } from '@deepseek-ai/cordis';
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

function files(path) {
  if (lstatSync(path).isSymbolicLink()) throw new Error('NATIVE_RECOVERY_LINK_FORBIDDEN');
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const item = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error('NATIVE_RECOVERY_LINK_FORBIDDEN');
    return entry.isDirectory() ? files(item) : [item];
  });
}
function needsWorkerSession(ticket, launches) {
  const assignments = ticket.assignments ?? [];
  // These facts are recorded after native session creation and input acceptance.
  // Keep history required even when a later assignment is pending or launch failed.
  const ran = assignments.some(assignment => assignment.state === 'running' ||
    ['startedAt', 'deliveredAt', 'idleAt'].some(field => Object.hasOwn(assignment, field)) ||
    (assignment.report && assignment.report.state !== 'failed')) ||
    (ticket.inputs ?? []).some(input => ['deliveredTo', 'deliveredAt', 'readAt'].some(field => Object.hasOwn(input, field)));
  if (ran) return true;
  const latest = assignments.at(-1);
  const neverStartedTerminal = !!ticket.ended || latest?.state === 'ended' || latest?.report?.state === 'failed';
  const queued = latest?.state === 'pending' && launches.has(JSON.stringify([ticket.id, latest.id]));
  // Accept the native pre-session lifecycle only with a durable launch or a
  // recorded pre-launch failure/stop. An orphan pending ticket still fails closed.
  return !neverStartedTerminal && !queued;
}
export async function validateNativeRecovery(dataDir) {
  const root = resolve(dataDir);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('NATIVE_RECOVERY_DIRECTORY_REQUIRED');
  const required = ['kv', 'trigger', 'disposition', 'thread', 'ticket', 'decision', 'outbox', 'trigger_thread', 'effect'];
  let databases = 0;
  const ticketIds = new Set();
  if (existsSync(join(root, 'superagent'))) {
    const database = join(root, 'superagent/orchestrator.sqlite');
    if (!existsSync(database) || lstatSync(database).isSymbolicLink()) throw new Error('NATIVE_DATABASE_REQUIRED');
    let db;
    try {
      // Checkpoint closes this owner. Immutable prevents SQLite's otherwise legal
      // read-only WAL open from creating -wal/-shm files inside the input tree.
      if (existsSync(`${database}-wal`) && lstatSync(`${database}-wal`).size) throw new Error();
      db = new DatabaseSync(`${pathToFileURL(database).href}?immutable=1`, { readOnly: true });
      if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error();
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      if (required.some(name => !tables.has(name))) throw new Error();
      if (JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key='schema'").get()?.value)) !== 11) throw new Error();
      for (const table of ['kv', 'trigger', 'disposition', 'thread', 'ticket', 'decision', 'outbox', 'effect'])
        for (const row of db.prepare(`SELECT value FROM ${table}`).all()) JSON.parse(String(row.value));
      const launches = new Set(db.prepare("SELECT key,value FROM effect WHERE kind='launch'").all().flatMap(row => {
        const payload = JSON.parse(String(row.value));
        return row.key === payload.assignmentId ? [JSON.stringify([payload.ticketId, payload.assignmentId])] : [];
      }));
      for (const row of db.prepare('SELECT id,value FROM ticket').all()) {
        const ticket = JSON.parse(String(row.value));
        if (ticket.id !== row.id) throw new Error();
        if (needsWorkerSession(ticket, launches)) ticketIds.add(`worker-${row.id}`);
      }
      databases++;
    } catch { throw new Error('NATIVE_DATABASE_INVALID'); }
    finally { db?.close(); }
  }
  const sessionsRoot = join(root, 'harness/sessions');
  let sessions = 0, events = 0;
  if (existsSync(sessionsRoot)) {
    // A coordinated checkpoint has no torn tail. Reject incomplete compressed frames
    // and physical records before the official reader's crash-prefix recovery path.
    const artifacts = files(sessionsRoot).filter(path => /(?:^|[/\\])session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(path));
    const encodings = new Set(artifacts.map(path => path.endsWith('.zstd') ? 'zstd' : 'none'));
    const physicalCounts = new Map();
    if (encodings.size > 1) throw new Error('NATIVE_SESSION_ENCODING_INVALID');
    try {
      for (const artifact of artifacts) {
        const raw = readFileSync(artifact);
        const plain = artifact.endsWith('.zstd') ? zstdDecompressSync(raw) : raw;
        if (!plain.length || plain.at(-1) !== 10) throw new Error();
        const records = plain.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
        const header = records[0];
        if (header.type !== 'session' || header.version !== SESSION_FORMAT_VERSION) throw new Error();
        if (physicalCounts.has(header.id) || records.slice(1).some((record, index) => record.seq !== index)) throw new Error();
        physicalCounts.set(header.id, records.length - 1);
      }
    } catch { throw new Error('NATIVE_SESSION_INVALID'); }
    const context = new Context();
    let fiber;
    try {
      fiber = context.plugin(jsonl, { root: sessionsRoot, compression: [...encodings][0] ?? 'zstd' });
      await fiber.await();
      const persistence = context.get('sessionPersistence');
      const snapshots = await persistence.list();
      for (const snapshot of snapshots) {
        if (snapshot.formatStatus && snapshot.formatStatus !== 'current') throw new Error();
        await using handle = await persistence.open(snapshot.header.id, 'read');
        const result = await handle.read(0);
        // Native crash recovery may return a valid prefix on an invalid trailing
        // record. A flushed backup must validate every committed physical record.
        if (result.events.length !== physicalCounts.get(snapshot.header.id)) throw new Error();
        sessions++; events += result.events.length;
        ticketIds.delete(snapshot.header.id);
      }
      if (sessions !== artifacts.length) throw new Error();
    } catch { throw new Error('NATIVE_SESSION_INVALID'); }
    finally { await fiber?.dispose(); }
  }
  if (ticketIds.size) throw new Error('NATIVE_WORKER_SESSION_REQUIRED');
  return { ok: true, databases, sessions, events };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('NATIVE_RECOVERY_DIRECTORY_REQUIRED');
    process.stdout.write(`${JSON.stringify(await validateNativeRecovery(process.argv[2]))}\n`);
  } catch (error) {
    const code = error instanceof Error && /^NATIVE_[A-Z_]{1,70}$/.test(error.message) ? error.message : 'NATIVE_RECOVERY_INVALID';
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);process.exitCode = 1;
  }
}
