/** Physical operations-directory authority, independent of Windows 8.3 spellings. */
import { lstatSync,mkdirSync,realpathSync,statSync } from 'node:fs'
import { dirname,isAbsolute,relative,resolve } from 'node:path'

const identity = (path: string): string => {
  const info = statSync(path, { bigint: true })
  return `${info.dev}:${info.ino}`
}
const same = (left: string, right: string): boolean => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right
function inside(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}
/** Inspect every existing lexical component before realpath can follow a link. */
export function assertNoWorkspaceLinks(path: string): void {
  let current = resolve(path)
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('OPERATIONS_WORKSPACE_LINK_FORBIDDEN')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}
function physicalDirectory(path: string): string {
  assertNoWorkspaceLinks(path)
  const canonical = realpathSync.native(resolve(path))
  assertNoWorkspaceLinks(canonical)
  if (!statSync(canonical).isDirectory()) throw new Error('OPERATIONS_WORKSPACE_CHANGED')
  return canonical
}
function guarded<T>(check: () => T): T {
  try { return check() }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('OPERATIONS_WORKSPACE_')) throw error
    throw new Error('OPERATIONS_WORKSPACE_CHANGED', { cause: error })
  }
}

export class OperationsWorkspaceAuthority {
  readonly root: string
  private readonly original: string
  private readonly rootIdentity: string
  constructor(stateDir: string) {
    this.original = resolve(stateDir)
    assertNoWorkspaceLinks(this.original)
    mkdirSync(this.original, { recursive: true })
    this.root = physicalDirectory(this.original)
    this.rootIdentity = identity(this.root)
    this.assertRoot()
  }
  /** A configured alias must still refer to the same regular physical root. */
  assertRoot(): void {
    guarded(() => {
      if (!same(physicalDirectory(this.original), this.root) || !same(physicalDirectory(this.root), this.root) ||
        identity(this.root) !== this.rootIdentity) throw new Error('OPERATIONS_WORKSPACE_CHANGED')
    })
  }
  /** Check parents before any mkdir, then recheck the created physical target. */
  prepareDirectory(path: string): string {
    this.assertRoot()
    const expected = resolve(path)
    assertNoWorkspaceLinks(expected)
    if (!inside(this.root, expected)) throw new Error('OPERATIONS_WORKSPACE_CHANGED')
    mkdirSync(expected, { recursive: true })
    this.assertRoot()
    const canonical = physicalDirectory(expected)
    if (!inside(this.root, canonical)) throw new Error('OPERATIONS_WORKSPACE_CHANGED')
    return canonical
  }
  /** Missing paths and changed/replaced/link targets always deny; no resolve fallback. */
  assertWorkspace(expected: string, current: string): void {
    guarded(() => {
      this.assertRoot()
      const canonicalExpected = physicalDirectory(expected)
      if (!inside(this.root, canonicalExpected) || !same(canonicalExpected, physicalDirectory(current)))
        throw new Error('OPERATIONS_WORKSPACE_CHANGED')
    })
  }
}
