import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSettings, scrubEnvironment } from '../../scripts/start.mjs';
import { localPatch } from '../../profiles/local.ts';
import { buildProject } from '../../scripts/build.mjs';
import { configuredOrigin, migrationReadAllowed, releaseHealth, sessionCookie, verifyRelease } from '../../packages/host/production.ts';
import { allowedRequest } from '../../packages/host/boundary.ts';
import { Auth } from '../../packages/host/auth.ts';

function settings(changes: object) {
  const home = mkdtempSync(join(tmpdir(), 'amazonops-production-settings-'));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ project: 'dsh-amazonops-superagent',
    password: 'synthetic-password-at-least-16', ...changes }));
  return home;
}

test('production settings reject noncanonical or credentialed public origins', () => {
  const credentialed = new URL('https://ops.example.test'); credentialed.username = 'synthetic'; credentialed.password = 'synthetic';
  for (const publicOrigin of ['http://ops.example.test', 'https://ops.example.test/path', credentialed.href,
    'https://ops.example.test?token=secret', 'https://ops.example.test#hash', 'https://OPS.example.test', 'https://ops.example.test/']) {
    assert.throws(() => loadSettings(settings({ publicOrigin }), {}), /PUBLIC_ORIGIN/);
  }
  assert.equal(loadSettings(settings({ publicOrigin: 'https://ops.example.test' }), {}).publicOrigin, 'https://ops.example.test');
});

test('migration mode is a boolean setting and cannot be enabled through a truthy string', () => {
  assert.throws(() => loadSettings(settings({ migrationMode: 'false' }), {}), /MIGRATION_MODE/);
  assert.equal(loadSettings(settings({ migrationMode: true }), {}).migrationMode, true);
});

test('profile forwards public origin and migration mode while hard disabling model access', () => {
  const rows = localPatch({ root: resolve('.'), home: join(tmpdir(), 'synthetic-production-home'), password: 'synthetic-password',
    port: 4315, live: true, modelAccount: 'runtime', publicOrigin: 'https://ops.example.test', migrationMode: true } as any);
  const entries = rows.flatMap(row => (row as { insert?: { id: string; config: Record<string, unknown> }[] }).insert ?? []);
  const config = entries.find(row => row.id === 'amazonops-host')!.config;
  assert.equal(config.publicOrigin, 'https://ops.example.test');
  assert.equal(config.migrationMode, true);
  assert.equal(config.live, false);
  assert.equal(entries.some(row => row.id === 'amazonops-superagent'), false,
    'migration inspection must not resume existing native workers or mutate their lifecycle');
  assert.equal((rows.find(row => (row as any).id === 'webserver') as any).config.host, '127.0.0.1');
});

test('Linux child HOME belongs to the isolated runtime rather than the operator home', () => {
  const home = join(tmpdir(), 'synthetic-runtime');
  const env = scrubEnvironment({ PATH: '/synthetic/bin', HOME: '/operator-private', TMPDIR: '/tmp',
    GIT_CONFIG_GLOBAL: '/operator-private/.gitconfig', SSH_AUTH_SOCK: '/operator-agent' }, home);
  assert.equal(env.HOME, home);
  assert.equal(env.TMPDIR, '/tmp');
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(env.SSH_AUTH_SOCK, undefined);
});

test('release manifest covers native bundles, launcher, dependency lock, patches and licensing', async () => {
  const root = resolve('.');
  await buildProject({ root });
  const release = JSON.parse(readFileSync(join(root, 'lib/release-manifest.json'), 'utf8'));
  const paths = new Set(release.artifacts.map((row: { path: string }) => row.path));
  for (const path of ['lib/index.js', 'lib/client.js', 'vendor/superagent/lib/index.js', 'vendor/superagent/lib/extension.js',
    'pnpm-lock.yaml', 'package.json', 'scripts/start.mjs', 'profiles/local.ts', 'vendor/superagent/LICENSE',
    'patches/@deepseek-ai__dsh-client-ui-workspace@0.2.1-rc.3.patch']) assert.ok(paths.has(path), path);
  assert.match(release.sourceSha, /^[0-9a-f]{40}$/);
});

test('exact public authority is enforced regardless of forged proxy headers', () => {
  const origin = configuredOrigin('http://127.0.0.1:4315', 'https://ops.example.test');
  const auth = new Auth('synthetic-password-at-least-16');
  const cookie = `amazonops_session=${auth.login('synthetic-password-at-least-16')}`;
  const request = { method: 'GET', url: '/api', headers: { host: 'ops.example.test', cookie } };
  assert.equal(allowedRequest(request, origin, auth), 200);
  assert.equal(allowedRequest({ ...request, headers: { ...request.headers, host: 'attacker.test', 'x-forwarded-host': 'ops.example.test' } }, origin, auth), 403);
  assert.equal(allowedRequest({ ...request, method: 'POST', headers: { ...request.headers, origin: 'https://attacker.test', 'x-forwarded-proto': 'https' } }, origin, auth), 403);
  assert.equal(allowedRequest({ method: 'GET', url: '/health', headers: { host: 'ops.example.test' } }, origin, auth), 200);
  assert.equal(allowedRequest({ method: 'GET', url: '/ready', headers: { host: 'ops.example.test' } }, origin, auth), 200);
  assert.equal(allowedRequest({ method: 'POST', url: '/health', headers: { host: 'ops.example.test', origin } }, origin, auth), 401);
  assert.equal(allowedRequest({ method: 'GET', url: '/health', headers: { host: 'attacker.test' } }, origin, auth), 403);
});

test('HTTPS login and logout cookies are secure without weakening local login', () => {
  assert.match(sessionCookie('synthetic-token', 'https://ops.example.test'), /; Secure$/);
  assert.match(sessionCookie('', 'https://ops.example.test', 0), /Max-Age=0; Secure$/);
  assert.ok(!sessionCookie('synthetic-token', 'http://127.0.0.1:4315').includes('Secure'));
  assert.throws(() => sessionCookie('token; injected=1', 'https://ops.example.test'), /INVALID_SESSION_COOKIE/);
});

test('migration allowlist has no backup, logout, prompt or action writer paths', () => {
  for (const path of ['/health', '/ready', '/amazonops/api/status', '/amazonops/api/snapshot', '/amazonops/api/work'])
    assert.equal(migrationReadAllowed(path, 'GET'), true);
  for (const path of ['/amazonops/api/backup', '/amazonops/api/actions/backup', '/amazonops/api/messages',
    '/amazonops/api/login', '/amazonops/api/logout', '/amazonops/api/actions/inventory', '/api/remote.mux'])
    for (const method of ['GET', 'POST']) assert.equal(migrationReadAllowed(path, method), false);
  assert.deepEqual(releaseHealth(undefined, false, true), { status: 'starting', ready: false, migrationMode: true,
    sourceSha: null, manifestSha256: null });
});

test('release verification rejects dirty builds, payload tampering and path traversal', async () => {
  const root = resolve('.');
  const manifest = JSON.parse(readFileSync(join(root, 'lib/release-manifest.json'), 'utf8'));
  const staged = mkdtempSync(join(tmpdir(), 'amazonops-release-verify-'));
  for (const artifact of manifest.artifacts) {
    const target = join(staged, artifact.path);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(join(root, artifact.path), target);
  }
  const path = join(staged, 'lib/release-manifest.json');
  manifest.sourceDirty = true;
  writeFileSync(path, JSON.stringify(manifest));
  const identity = verifyRelease(staged, { requireClean: false });
  assert.equal(identity.sourceSha, manifest.sourceSha);
  assert.match(identity.manifestSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => verifyRelease(staged), /INVALID_RELEASE_MANIFEST/);
  manifest.sourceDirty = false;
  writeFileSync(path, JSON.stringify(manifest));
  assert.equal(verifyRelease(staged).sourceSha, manifest.sourceSha);
  const first = manifest.artifacts[0];
  const old = readFileSync(join(staged, first.path));
  writeFileSync(join(staged, first.path), 'tampered');
  assert.throws(() => verifyRelease(staged), /RELEASE_HASH_MISMATCH/);
  writeFileSync(join(staged, first.path), old);
  manifest.artifacts.push({ path: '../escape', bytes: 0, sha256: '0'.repeat(64) });
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyRelease(staged), /RELEASE_PATH_FORBIDDEN/);
});

test('artifact-only release imports the actual native extension without the source checkout',()=>{
  const root=resolve('.'),staged=mkdtempSync(join(tmpdir(),'amazonops-artifact-import-'));
  const manifest=JSON.parse(readFileSync(join(root,'lib/release-manifest.json'),'utf8'));
  for(const artifact of manifest.artifacts){
    const target=join(staged,artifact.path);mkdirSync(join(target,'..'),{recursive:true});copyFileSync(join(root,artifact.path),target);
  }
  // Dependencies are supplied independently; no vendor source-tree assets leak
  // into the staged package through its working directory.
  symlinkSync(join(root,'node_modules'),join(staged,'node_modules'),'junction');
  const loaded=spawnSync(process.execPath,['--input-type=module','-e','await import(process.argv[1])',
    pathToFileURL(join(staged,'vendor/superagent/lib/extension.js')).href],{cwd:staged,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(loaded.status,0,loaded.stderr);
});
