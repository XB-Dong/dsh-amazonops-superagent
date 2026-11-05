/** Canonical full-table state: revision timestamps are never a change cursor. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './migration-files.ts';

export type RowRecord = { key: string; sha256: string };
export type TableRecord = { name: string; schema: string; rows: RowRecord[] };
export type DatabaseRecord = { path: string; tables: TableRecord[] };
function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return typeof value === 'bigint' ? { bigint: String(value) } : value;
}
const stringify = (value: unknown) => JSON.stringify(canonical(value));
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function databaseState(path: string, name: string): DatabaseRecord {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('MIGRATION_DATABASE_INVALID');
    const definitions = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return { path: name, tables: definitions.map(definition => {
      const table = String(definition.name);
      const columns = db.prepare(`PRAGMA table_info(${quoted(table)})`).all();
      const keys = columns.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => String(column.name));
      const rows = db.prepare(`SELECT * FROM ${quoted(table)}`).all().map(row => ({
        key: keys.length ? stringify(keys.map(key => row[key])) : hash(stringify(row)), sha256: hash(stringify(row)),
      })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0);
      return { name: table, schema: String(definition.sql), rows };
    }) };
  } finally { db.close(); }
}
export function sqliteFile(path: string): boolean {
  return readFileSync(path).subarray(0, 16).toString('binary') === 'SQLite format 3\0';
}
export type Difference = { database: string; table: string; key: string };
export type MigrationDifference = { equal: boolean; added: Difference[]; removed: Difference[]; changed: Difference[]; schemas: string[]; files: string[]; registryChanged: boolean };
export function compareStates(before: DatabaseRecord[], after: DatabaseRecord[]): Pick<MigrationDifference, 'added' | 'removed' | 'changed' | 'schemas'> {
  const result: Pick<MigrationDifference, 'added' | 'removed' | 'changed' | 'schemas'> = { added: [], removed: [], changed: [], schemas: [] };
  const flat = (databases: DatabaseRecord[]) => new Map(databases.flatMap(db => db.tables.map(table => [`${db.path}\0${table.name}`, { database: db.path, table }] as const)));
  const a = flat(before), b = flat(after);
  for (const identity of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(identity), next = b.get(identity), reference = old ?? next!;
    if (old?.table.schema !== next?.table.schema) result.schemas.push(`${reference.database}:${reference.table.name}`);
    // Hash arrays preserve duplicate rows in tables without a declared primary key.
    const group = (rows: RowRecord[]) => {
      const values = new Map<string, string[]>();
      for (const row of rows) values.set(row.key, [...(values.get(row.key) ?? []), row.sha256]);
      return values;
    };
    const oldRows = group(old?.table.rows ?? []), nextRows = group(next?.table.rows ?? []);
    for (const key of new Set([...oldRows.keys(), ...nextRows.keys()])) {
      const item = { database: reference.database, table: reference.table.name, key };
      if (!oldRows.has(key)) result.added.push(item);
      else if (!nextRows.has(key)) result.removed.push(item);
      else if (JSON.stringify(oldRows.get(key)) !== JSON.stringify(nextRows.get(key))) result.changed.push(item);
    }
  }
  return result;
}
export function statesAt(root: string, names: string[]): DatabaseRecord[] {
  return names.map(name => databaseState(join(root, name), name));
}
