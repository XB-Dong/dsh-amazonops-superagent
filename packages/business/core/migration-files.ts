/** Private filesystem primitives shared by migration capture and staged publication. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type FileRecord = { path: string; bytes: number; sha256: string };
export const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
export function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
export function unlinked(path: string): void {
  for (let current = resolve(path);; current = dirname(current)) {
    let info;
    try { info = lstatSync(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink()) throw new Error('MIGRATION_LINK_FORBIDDEN');
    if (dirname(current) === current) return;
  }
}
export function directory(path: string): string {
  unlinked(path);
  if (!lstatSync(path).isDirectory()) throw new Error('MIGRATION_DIRECTORY_REQUIRED');
  return realpathSync(path);
}
/** Resolve existing physical ancestors before comparing paths, including Windows DOS aliases. */
export function physical(path: string): string {
  unlinked(path);
  const requested = resolve(path);
  let ancestor = requested;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('MIGRATION_DIRECTORY_REQUIRED');
    ancestor = parent;
  }
  const result = resolve(realpathSync.native(ancestor), relative(ancestor, requested));
  unlinked(result);
  return result;
}
export function emptyDestination(source: string, target: string): string {
  unlinked(target);
  const destination = physical(target), input = physical(source);
  if (inside(input, destination) || inside(destination, input)) throw new Error('MIGRATION_INPUT_OVERLAP');
  if (existsSync(destination) && (!lstatSync(destination).isDirectory() || readdirSync(destination).length))
    throw new Error('MIGRATION_TARGET_NOT_EMPTY');
  return destination;
}
export function safeName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || isAbsolute(name) ||
    /[\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('MIGRATION_PATH_FORBIDDEN');
}
export function inventory(root: string, excluded: readonly string[] = [], path = root): FileRecord[] {
  unlinked(root);
  const result: FileRecord[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = join(path, entry.name), name = relative(root, file).replaceAll('\\', '/');
    safeName(name);
    if (excluded.some(item => name === item || name.startsWith(`${item}/`))) continue;
    if (entry.isSymbolicLink()) throw new Error('MIGRATION_LINK_FORBIDDEN');
    if (entry.isDirectory()) result.push(...inventory(root, excluded, file));
    else {
      if (!entry.isFile()) throw new Error('MIGRATION_REGULAR_FILE_REQUIRED');
      const bytes = readFileSync(file);
      result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return result;
}
export function copyInventory(source: string, destination: string, files: readonly FileRecord[]): void {
  for (const item of files) {
    safeName(item.path);
    const input = join(source, item.path), output = join(destination, item.path);
    unlinked(input); unlinked(output);
    if (!lstatSync(input).isFile()) throw new Error('MIGRATION_REGULAR_FILE_REQUIRED');
    const bytes = readFileSync(input);
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error('MIGRATION_SOURCE_CHANGED');
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 }); copyFileSync(input, output);
  }
}
export function removeStage(stage: string, parent: string): void {
  if (dirname(resolve(stage)) !== resolve(parent) || !stage.startsWith(join(parent, '.amazonops-migration-')))
    throw new Error('MIGRATION_STAGE_PATH_FORBIDDEN');
  unlinked(stage); rmSync(stage, { recursive: true, force: true });
}
