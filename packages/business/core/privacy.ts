import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some((item) => references(item, ids));
  return (
    !!value &&
    typeof value === 'object' &&
    Object.entries(value).some(([key, item]) => key !== 'sessionId' && references(item, ids))
  );
}
export function eraseClosure(
  db: DatabaseSync,
  scope: string,
  id: string,
  at: string,
  retireHistory = true,
): void {
  const ids = new Set([id]);
  const rows = db
    .prepare('SELECT id,payload FROM entities WHERE scope=?')
    .all(scope)
    .map((row) => ({ id: String(row.id), data: JSON.parse(String(row.payload)) }));
  // History is conservatively retired so an old native context cannot revive erased facts.
  for (const row of rows)
    if (
      retireHistory &&
      ['summary', 'conversation'].includes(row.data.kind) &&
      row.data.createdAt <= at
    )
      ids.add(row.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (!ids.has(row.id) && references(row.data, ids)) {
        ids.add(row.id);
        changed = true;
      }
  }
  for (const removed of ids) {
    db.prepare('INSERT OR IGNORE INTO tombstones VALUES (?,?,?)').run(scope, removed, at);
    db.prepare('DELETE FROM entities WHERE scope=? AND id=?').run(scope, removed);
  }
  for (const receipt of db
    .prepare('SELECT request_key,result FROM receipts WHERE scope=?')
    .all(scope)) {
    if (references(JSON.parse(String(receipt.result)), ids))
      db.prepare('UPDATE receipts SET result=? WHERE scope=? AND request_key=?').run(
        '{"deleted":true}',
        scope,
        String(receipt.request_key),
      );
  }
}
export function applyPrivacyLedger(db: DatabaseSync, path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { scope: string; id: string; action: string; at: string };
    // Old readers marked unknown actions applied; the new note action needs its own namespace.
    const version = row.action === 'delete-note' ? 'closure-v3-note' : 'closure-v2';
    const eventId = createHash('sha256').update(`${version}:${line}`).digest('hex');
    if (db.prepare('SELECT id FROM privacy_applied WHERE id=?').get(eventId)) continue;
    if (row.action === 'delete' || row.action === 'delete-note') {
      eraseClosure(db, row.scope, row.id, row.at, row.action !== 'delete-note');
      const root = resolve(dirname(path), 'exports');
      const directory = resolve(root, row.scope);
      if (!directory.startsWith(root + '/') && !directory.startsWith(root + '\\'))
        throw new Error('EXPORT_PATH_FORBIDDEN');
      if (existsSync(directory))
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isFile()) rmSync(join(directory, entry.name));
        }
    } else if (row.action === 'revoke') {
      const raw = db
        .prepare('SELECT payload FROM entities WHERE scope=? AND id=?')
        .get(row.scope, row.id);
      if (raw) {
        const skill = JSON.parse(String(raw.payload));
        skill.status = 'revoked';
        db.prepare('UPDATE entities SET payload=? WHERE scope=? AND id=?').run(
          JSON.stringify(skill),
          row.scope,
          row.id,
        );
      }
    }
    db.prepare('INSERT OR IGNORE INTO privacy_applied VALUES (?)').run(eventId);
  }
}
