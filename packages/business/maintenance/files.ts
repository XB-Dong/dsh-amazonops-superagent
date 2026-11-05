import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function noLinks(path: string): void {
  for (let entry = resolve(path);; entry = dirname(entry)) {
    if (existsSync(entry) && lstatSync(entry).isSymbolicLink()) throw new Error('MAINTENANCE_LINK_FORBIDDEN');
    if (dirname(entry) === entry) return;
  }
}
export function physical(path: string): string {
  noLinks(path);
  let existing = resolve(path);
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error('MAINTENANCE_INPUT_INVALID');
    existing = parent;
  }
  return resolve(realpathSync.native(existing), relative(existing, resolve(path)));
}
export function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
export function readJson(path: string, code: string): any {
  try {
    noLinks(path);
    if (!lstatSync(path).isFile()) throw new Error(code);
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.message === 'MAINTENANCE_LINK_FORBIDDEN') throw error;
    throw new Error(code);
  }
}
export function outputPath(path: string, inputs: string[]): string {
  const destination = physical(path);
  if (existsSync(destination)) throw new Error('MAINTENANCE_OUTPUT_EXISTS');
  for (const input of inputs) {
    const source = physical(input);
    if (source === destination || (existsSync(source) && lstatSync(source).isDirectory() && within(source, destination)))
      throw new Error('MAINTENANCE_OUTPUT_OVERLAP');
  }
  for (let ancestor = dirname(destination);; ancestor = dirname(ancestor)) {
    if (existsSync(join(ancestor, '.git'))) throw new Error('MAINTENANCE_OUTPUT_IN_REPOSITORY');
    if (dirname(ancestor) === ancestor) break;
  }
  return destination;
}
export function writeNew(path: string, value: unknown): void {
  noLinks(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); noLinks(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx', flush: true });
}
