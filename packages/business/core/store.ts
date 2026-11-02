import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyPrivacyLedger } from './privacy.ts';

export type Base = {
  id: string;
  scope: string;
  kind: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Source = Base & {
  kind: 'source';
  text: string;
  origin: 'user' | 'tool';
  sessionId?: string;
};
export type BusinessEvent = {
  sequence: number; id: string; scope: string; kind: string;
  entityId?: string; entityRevision?: number; createdAt: string;
};
export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const now = (): string => new Date().toISOString();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export class Store {
  db: DatabaseSync;
  ledgerPath: string;
  private transactionDepth = 0;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.ledgerPath = join(dirname(path), 'privacy-ledger.jsonl');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities (
        scope TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(scope,id)
      );
      CREATE TABLE IF NOT EXISTS receipts (
        scope TEXT NOT NULL, request_key TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(scope,request_key)
      );
      CREATE TABLE IF NOT EXISTS tombstones (scope TEXT NOT NULL,id TEXT NOT NULL,deleted_at TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS privacy_applied (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS business_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, scope TEXT NOT NULL,
        kind TEXT NOT NULL, entity_id TEXT, entity_revision INTEGER, created_at TEXT NOT NULL
      );
      PRAGMA user_version=1;`);
    this.applyPrivacyLedger();
  }
  privacyIntent(scope: string, id: string, action: 'delete' | 'delete-note' | 'revoke'): void {
    // Persist fail-closed intent before changing a recoverable projection.
    appendFileSync(this.ledgerPath, `${JSON.stringify({ scope, id, action, at: now() })}\n`, {
      mode: 0o600,
      flush: true,
    });
  }
  applyPrivacyLedger(): void {
    applyPrivacyLedger(this.db, this.ledgerPath);
  }
  transaction<T>(fn: () => T): T {
    const nested = this.transactionDepth > 0;
    const savepoint = `business_${this.transactionDepth + 1}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const value = fn();
      this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return value;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  command<T>(scope: string, key: string, payload: unknown, execute: () => T): T {
    const fingerprint = digest(canonical(payload));
    return this.transaction(() => {
      const row = this.db.prepare('SELECT result FROM receipts WHERE scope=? AND request_key=?')
        .get(scope, `command:${key}`);
      if (row) {
        const receipt = JSON.parse(String(row.result));
        if (receipt.deleted) throw new Error('DERIVATION_REVOKED');
        if (receipt.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT');
        return receipt.value as T;
      }
      const value = execute();
      this.db.prepare('INSERT INTO receipts VALUES (?,?,?)')
        .run(scope, `command:${key}`, JSON.stringify({ fingerprint, value }));
      return value;
    });
  }
  appendEvent(scope: string, kind: string, entity?: { id?: string; revision?: number }): void {
    // Derived events contain references only; they are never new authorized agent requests.
    this.db.prepare('INSERT INTO business_events (id,scope,kind,entity_id,entity_revision,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), scope, kind, entity?.id ?? null, entity?.revision ?? null, now());
  }
  events(scope: string, afterSequence = 0, limit = 100): BusinessEvent[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('INVALID_OFFSET');
    return this.db.prepare('SELECT * FROM business_events WHERE scope=? AND sequence>? ORDER BY sequence LIMIT ?')
      .all(scope, afterSequence, limit).map(row => ({ sequence: Number(row.sequence), id: String(row.id),
        scope: String(row.scope), kind: String(row.kind), entityId: row.entity_id === null ? undefined : String(row.entity_id),
        entityRevision: row.entity_revision === null ? undefined : Number(row.entity_revision), createdAt: String(row.created_at) }));
  }
  list<T extends Base>(scope: string, kind: string): T[] {
    return this.db
      .prepare('SELECT payload FROM entities WHERE scope=? AND kind=? ORDER BY rowid DESC')
      .all(scope, kind)
      .map((row) => JSON.parse(String(row.payload)) as T);
  }
  get<T extends Base>(scope: string, id: string): T {
    const row = this.db
      .prepare('SELECT payload FROM entities WHERE scope=? AND id=?')
      .get(scope, id);
    if (!row) throw new Error('NOT_FOUND');
    return JSON.parse(String(row.payload)) as T;
  }
  create<T extends object>(
    scope: string,
    kind: string,
    data: T,
    id: string = randomUUID(),
  ): T & Base {
    if (this.isDeleted(scope, id)) throw new Error('SOURCE_DELETED');
    const entity = { ...data, id, scope, kind, revision: 1, createdAt: now(), updatedAt: now() };
    this.db
      .prepare('INSERT INTO entities (scope,kind,id,revision,payload) VALUES (?,?,?,?,?)')
      .run(scope, kind, id, 1, JSON.stringify(entity));
    return entity;
  }
  update<T extends Base>(entity: T, changes: Partial<T>, expected = entity.revision): T {
    const next = {
      ...entity,
      ...changes,
      id: entity.id,
      scope: entity.scope,
      kind: entity.kind,
      revision: expected + 1,
      updatedAt: now(),
    };
    const result = this.db
      .prepare('UPDATE entities SET payload=?,revision=? WHERE scope=? AND id=? AND revision=?')
      .run(JSON.stringify(next), next.revision, entity.scope, entity.id, expected);
    if (result.changes !== 1) throw new Error('REVISION_CONFLICT');
    return next;
  }
  once<T>(scope: string, key: string, fn: () => T): T {
    return this.transaction(() => {
      const receipt = this.db
        .prepare('SELECT result FROM receipts WHERE scope=? AND request_key=?')
        .get(scope, key);
      if (receipt) {
        const result = JSON.parse(String(receipt.result));
        if (result?.deleted === true) throw new Error('DERIVATION_REVOKED');
        return result as T;
      }
      const result = fn();
      this.db
        .prepare('INSERT INTO receipts VALUES (?,?,?)')
        .run(scope, key, JSON.stringify(result));
      return result;
    });
  }
  source(scope: string, text: string, id?: string, sessionId?: string): Source {
    if (!text.trim() || text.length > 12000) throw new Error('INVALID_SOURCE');
    return this.create(scope, 'source', { text, origin: 'user' as const, sessionId }, id) as Source;
  }
  isDeleted(scope: string, id: string): boolean {
    return !!this.db.prepare('SELECT id FROM tombstones WHERE scope=? AND id=?').get(scope, id);
  }
  remove(scope: string, id: string, action: 'delete' | 'delete-note' = 'delete'): void {
    if (action === 'delete-note' && this.get(scope, id).kind !== 'note')
      throw new Error('INVALID_NOTE');
    this.privacyIntent(scope, id, action);
    this.applyPrivacyLedger();
  }
  close(): void {
    this.db.close();
  }
}
