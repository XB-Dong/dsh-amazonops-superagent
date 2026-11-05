import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BudgetPolicy, Limits } from '../business/core/budget.ts';

export type ReleaseIdentity = Readonly<{ sourceSha: string; manifestSha256: string }>;

export type RuntimeProtection = { runtimePolicy?: BudgetPolicy; runtimeLimits?: Limits };
export function budgetConfiguration(settings: RuntimeProtection & { modelAccount?: 'test' | 'runtime'; publicOrigin?: string }) {
  const unlimited: Limits = { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null };
  const policy = settings.runtimePolicy;
  const limits = settings.runtimeLimits;
  if (policy !== undefined && (!policy || !/^[a-z][a-z0-9-]{0,63}$/.test(policy.account) || !['daily', 'lifetime'].includes(policy.period)))
    throw new Error('INVALID_BUDGET_POLICY');
  if (limits !== undefined && (!limits || Object.keys(limits).length !== 4 || Object.keys(unlimited).some(key => {
    const value = limits[key as keyof Limits]; return value !== null && (!Number.isSafeInteger(value) || value <= 0);
  }))) throw new Error('INVALID_MODEL_BUDGET');
  if (settings.publicOrigin && settings.modelAccount === 'runtime' && (!policy || !limits)) throw new Error('RUNTIME_POLICY_REQUIRED');
  return settings.modelAccount === 'runtime'
    ? { limits: limits ?? unlimited, policy: policy ?? { account: 'amazonops-runtime', period: 'daily' as const } }
    : { limits: unlimited, policy: { account: 'amazonops-test', period: 'lifetime' as const } };
}

/** Public authority is explicit configuration, never an incoming forwarded header. */
export function configuredOrigin(localOrigin: string, publicOrigin?: unknown): string {
  if (publicOrigin === undefined) return new URL(localOrigin).origin;
  if (typeof publicOrigin !== 'string') throw new Error('INVALID_PUBLIC_ORIGIN');
  let value: URL;
  try { value = new URL(publicOrigin); } catch { throw new Error('INVALID_PUBLIC_ORIGIN'); }
  if (value.protocol !== 'https:' || value.username || value.password || value.origin !== publicOrigin)
    throw new Error('INVALID_PUBLIC_ORIGIN');
  return publicOrigin;
}

export function migrationSetting(value: unknown): boolean {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('INVALID_MIGRATION_MODE');
  return value === true;
}

export function sessionCookie(token: string, origin: string, maxAge = 28800): string {
  if (!/^[A-Za-z0-9_-]*$/.test(token) || !Number.isSafeInteger(maxAge) || maxAge < 0) throw new Error('INVALID_SESSION_COOKIE');
  return `amazonops_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`;
}

/** During staging only explicit side-effect-free reads are available. */
export function migrationReadAllowed(path: string, method: string | undefined): boolean {
  return ['GET', 'HEAD'].includes(method ?? '') &&
    ['/health', '/ready', '/amazonops/api/status', '/amazonops/api/snapshot', '/amazonops/api/work'].includes(path);
}

export function releaseHealth(identity: ReleaseIdentity | undefined, ready: boolean, migrationMode = false) {
  return { status: ready ? 'ok' : 'starting', ready, migrationMode,
    sourceSha: identity?.sourceSha ?? null, manifestSha256: identity?.manifestSha256 ?? null };
}

/** Verify the immutable release's bytes before accepting its advertised identity. */
export function verifyRelease(root: string, options: { requireClean?: boolean } = {}): ReleaseIdentity {
  const base = realpathSync(root);
  const manifestFile = join(base, 'lib', 'release-manifest.json');
  if (!lstatSync(manifestFile).isFile() || lstatSync(manifestFile).isSymbolicLink()) throw new Error('INVALID_RELEASE_MANIFEST');
  const bytes = readFileSync(manifestFile);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== '0.3' || !/^[0-9a-f]{40}$/.test(manifest.sourceSha) ||
    (options.requireClean !== false && manifest.sourceDirty !== false) || !Array.isArray(manifest.artifacts))
    throw new Error('INVALID_RELEASE_MANIFEST');
  const seen = new Set<string>();
  for (const row of manifest.artifacts) {
    if (typeof row.path !== 'string' || !row.path || isAbsolute(row.path) || row.path.includes('\\') || row.path.includes(':') ||
      row.path.split('/').some((part: string) => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(row.path) || seen.has(row.path))
      throw new Error('RELEASE_PATH_FORBIDDEN');
    seen.add(row.path);
    let file = base;
    for (const part of row.path.split('/')) {
      file = join(file, part);
      if (lstatSync(file).isSymbolicLink()) throw new Error('RELEASE_PATH_FORBIDDEN');
    }
    const rel = relative(base, resolve(file));
    if (rel === '..' || rel.startsWith(`..${sep}`) || !lstatSync(file).isFile()) throw new Error('RELEASE_PATH_FORBIDDEN');
    const content = readFileSync(file);
    if (content.length !== row.bytes || createHash('sha256').update(content).digest('hex') !== row.sha256)
      throw new Error('RELEASE_HASH_MISMATCH');
  }
  for (const required of ['lib/index.js', 'lib/client.js', 'lib/client.css', 'vendor/superagent/lib/index.js',
    'vendor/superagent/lib/extension.js', 'package.json', 'pnpm-lock.yaml', 'profiles/local.ts', 'scripts/start.mjs',
    'packages/host/production.ts', 'vendor/superagent/LICENSE', 'vendor/superagent/package.json', 'THIRD-PARTY-NOTICES.md',
    'patches/@deepseek-ai__dsh-client-ui-workspace@0.2.1-rc.3.patch',
    'vendor/superagent/UPSTREAM.json', 'vendor/superagent/patch-manifest.json'])
    if (!seen.has(required)) throw new Error('RELEASE_INVENTORY_INCOMPLETE');
  return Object.freeze({ sourceSha: manifest.sourceSha, manifestSha256: createHash('sha256').update(bytes).digest('hex') });
}
