import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { operationsPatch } from '../../profiles/operations.ts';

test('actual DSH web profile mounts upstream Runtime, Engine, Store and constrained master', { timeout: 90000 }, async () => {
  const root = resolve('.');
  const output = join(root, 'vendor/superagent/lib/native-probe.js');
  await build({ entryPoints: [join(root, 'tests/native/native-probe-plugin.ts')], outfile: output,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const home = mkdtempSync(join(tmpdir(), 'amazonops-native-'));
  const state = join(home, 'orchestrator');
  const portServer = createServer();
  await new Promise<void>(done => portServer.listen(0, '127.0.0.1', done));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>(done => portServer.close(() => done()));
  const patch = join(home, 'native.json');
  writeFileSync(patch, JSON.stringify([
    ...operationsPatch(state, output.replaceAll('\\', '/')),
    { id: 'webserver', config: { host: '127.0.0.1', port } },
    { id: 'llm-deepseek', config: { apiKeyEnv: 'AMAZONOPS_OFFLINE_KEY', baseURL: 'http://127.0.0.1:1',
      models: [{ id: 'deepseek-flash', name: 'Offline probe', contextWindow: 4096, maxTokens: 512 }],
      retryPolicy: { mode: 'normal', maxRetries: 0 } } },
  ]));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  env.DSH_HOME = home;
  env.AMAZONOPS_OFFLINE_KEY = 'offline-probe-only';
  const child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  const collect = (value: unknown) => {
    logs += String(value);
    writeFileSync(join(home, 'startup.log'), logs.replace(/(\?token=)[\w-]+/g, '$1[redacted]'));
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  try {
    let data: Record<string, unknown> | undefined;
    let lastResponse = '';
    const deadline = Date.now() + 70000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Native host exited ${child.exitCode}: ${logs.replace(/(\?token=)[\w-]+/g, '$1[redacted]').slice(-10000)}`);
      if (logs.includes('entry did not activate')) throw new Error(`Native activation failed: ${logs.replace(/(\?token=)[\w-]+/g, '$1[redacted]').slice(-12000)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/native-probe`, { signal: AbortSignal.timeout(500) });
        lastResponse = `${response.status}: ${await response.text()}`;
        if (response.ok) {
          const value = JSON.parse(lastResponse.slice(lastResponse.indexOf(':') + 2)) as Record<string, unknown>;
          if (value.ready || value.failed) { data = value; break; }
        }
      } catch { /* The native host is still composing its services. */ }
      await new Promise(done => setTimeout(done, 250));
    }
    assert.ok(data, `Native host did not become ready: ${lastResponse.slice(0, 2000)} ${logs.replace(/(\?token=)[\w-]+/g, '$1[redacted]').slice(-12000)}`);
    assert.equal(data.failed, undefined, `Native probe failed: ${JSON.stringify(data)}`);
    assert.equal(data.configured, true);
    assert.equal(data.mode, 'operations');
    assert.equal(data.engine, 'Engine');
    assert.equal(data.store, 'Store');
    assert.equal(data.executor, 'DshExecutor');
    assert.equal(data.masterPreset, 'dsh-superagent-router');
    assert.deepEqual(data.permission, { preset: 'amazonops-operator' });
    assert.equal(data.guardVerified, true);
    assert.equal(data.automaticModelRetries, 0);
    assert.ok(Array.isArray(data.tools));
    for (const forbidden of ['bash', 'pwsh', 'write', 'read', 'subagent', 'orchestrator_settings_save', 'orchestrator_prompts_save']) {
      assert.ok(!(data.tools as string[]).includes(forbidden), `Forbidden managed tool ${forbidden}`);
    }
    mkdirSync(join(home, 'evidence'), { recursive: true });
    writeFileSync(join(home, 'evidence/startup.json'), JSON.stringify(data, null, 2));
  } finally {
    child.kill();
    await new Promise<void>(done => { if (child.exitCode !== null) done(); else { child.once('exit', () => done()); setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000).unref(); } });
  }
});
