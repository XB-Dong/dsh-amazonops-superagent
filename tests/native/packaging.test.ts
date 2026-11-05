import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadSettings, redactOutput, scrubEnvironment, start, lineWriter } from '../../scripts/start.mjs';
import { buildProject } from '../../scripts/build.mjs';
import { localPatch } from '../../profiles/local.ts';

test('launcher rejects a relative runtime home before creating private state', () => {
  const before = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'amazonops-package-home-'));
  const root = resolve('.');
  try {
    process.chdir(temporary);
    assert.throws(() => start({ root, env: { AMAZONOPS_HOME: 'relative-state' }, stdout() {}, stderr() {} }));
    assert.equal(existsSync(join(temporary, 'relative-state')), false);
  } finally { process.chdir(before); }
});

test('private settings generate a strong stable password and default test account', () => {
  const home = join(mkdtempSync(join(tmpdir(), 'amazonops-package-settings-')), 'new-home');
  const first = loadSettings(home, {});
  assert.ok(first.password.length >= 32);
  assert.equal(first.modelAccount, 'test');
  const second = loadSettings(home, { AMAZONOPS_PORT: '49201' });
  assert.equal(second.password, first.password);
  assert.equal(second.port, 49201);
  assert.ok(!readFileSync(first.settingsPath, 'utf8').includes('AMAZONOPS_API_KEY'));
});

test('private launch state cannot be initialized inside the source repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-package-repository-'));
  const home = join(root, 'private-state');
  assert.throws(() => start({ root, env: { AMAZONOPS_HOME: home }, stdout() {}, stderr() {} }), /outside the repository/);
  assert.equal(existsSync(home), false);
});

test('unrecognized existing homes are not adopted or overwritten', () => {
  const home = mkdtempSync(join(tmpdir(), 'amazonops-package-unrecognized-'));
  writeFileSync(join(home, 'foreign.txt'), 'synthetic old runtime');
  assert.throws(() => loadSettings(home, {}), /non-empty home/);
  assert.equal(existsSync(join(home, 'settings.json')), false);
});

test('spawn environment carries only OS necessities, this home and the explicit model key', () => {
  const environment = scrubEnvironment({ PATH: 'synthetic-path', GITHUB_TOKEN: 'not-for-child',
    SSH_AUTH_SOCK: 'not-for-child', DEEPSEEK_API_KEY: 'not-for-child', NODE_OPTIONS: '--require malicious',
    AMAZONOPS_API_KEY: 'explicit-key' }, 'D:/synthetic-home', 'explicit-key');
  assert.deepEqual(Object.keys(environment).sort(), ['AMAZONOPS_API_KEY', 'DSH_HOME', ...process.platform === 'win32' ? [] : ['HOME'], 'PATH'].sort());
  assert.equal(environment.AMAZONOPS_API_KEY, 'explicit-key');
  assert.equal(environment.DSH_HOME.replaceAll('\\', '/'), 'D:/synthetic-home/data/harness');
});

test('business backup root contains both native session and orchestrator state owners', () => {
  const rows = localPatch({ root: 'D:/synthetic-app', home: 'D:/synthetic-home', password: 'synthetic-password',
    port: 4315, live: false, modelAccount: 'test' });
  const entries = rows.flatMap(row => (row as { insert?: { id: string; config: Record<string, unknown> }[] }).insert ?? []);
  const host = entries.find(row => row.id === 'amazonops-host')!;
  const native = entries.find(row => row.id === 'amazonops-superagent')!;
  assert.equal(host.config.dataDir, 'D:/synthetic-home/data');
  assert.equal(native.config.stateDir, 'D:/synthetic-home/data/superagent');
});

test('log redaction removes launch tokens and buffers secrets split across chunks', () => {
  assert.equal(redactOutput('dsh web: http://127.0.0.1:4315/?token=secret-launch-token\n'), 'dsh web: http://127.0.0.1:4315/\n');
  let output = '';
  const writer = lineWriter(value => { output += value; }, ['private-password', 'model-key']);
  writer.push('http://127.0.0.1:4315/?token=split-');
  writer.push('token private-pass');
  assert.equal(output, '');
  writer.push('word model-key\n');
  writer.flush();
  assert.ok(!output.includes('split-token'));
  assert.ok(!output.includes('private-password'));
  assert.ok(!output.includes('model-key'));
});

test('packaging builds actual vendor and client while preserving the native asset boundary', async () => {
  const root = resolve('.');
  const fixture = mkdtempSync(join(tmpdir(), 'amazonops-package-build-'));
  const hostEntry = join(fixture, 'host.ts');
  writeFileSync(hostEntry, `export {Runtime} from ${JSON.stringify(join(root, 'vendor/superagent/src/extension.ts').replaceAll('\\', '/'))};\n`);
  const outDir = join(fixture, 'application');
  const manifest = await buildProject({ root, hostEntry, outDir });
  assert.equal(manifest.artifacts.length, 3);
  assert.equal(manifest.superagentSha, '6337fc823ce20251c8de8085948165c81aaa701e');
  const host = await import(pathToFileURL(join(outDir, 'index.js')).href);
  assert.equal(host.Runtime.name, 'Runtime');
  const client = readFileSync(join(outDir, 'client.js'), 'utf8');
  assert.ok(client.includes('window.__ModuleLoader__.load({id:"dsh-amazonops-superagent"'));
  assert.ok(client.includes('require("react")'));
  assert.ok(readFileSync(join(outDir, 'client.css'), 'utf8').includes('.amazonops'));
  assert.equal(JSON.parse(readFileSync(join(root, 'vendor/superagent/package.json'), 'utf8')).dsh.client, undefined);
});
