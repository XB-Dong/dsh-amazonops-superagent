import test from 'node:test';
import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, loadSettings } from '../../scripts/start.mjs';

function snapshot(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = lstatSync(path);
    return [name, stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? snapshot(path) : readFileSync(path).toString('hex')];
  });
}
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'amazonops-launch-isolation-'));
  const root = join(base, 'repo'), home = join(base, 'home'), target = join(base, 'old-runtime');
  for (const path of [root, home, target]) mkdirSync(path);
  for (const file of ['lib/index.js', 'lib/client.js', 'vendor/superagent/lib/index.js', 'vendor/superagent/lib/extension.js']) {
    const parts = file.split('/'); const name = parts.pop()!;
    mkdirSync(join(root, ...parts), { recursive: true }); writeFileSync(join(root, ...parts, name), '');
  }
  const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh'); mkdirSync(join(pkg, 'lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}'); writeFileSync(join(pkg, 'package.json'), '{"name":"@deepseek-ai/dsh"}');
  writeFileSync(join(pkg, 'lib', 'bin.js'), '');
  const settings = JSON.stringify({ project: 'dsh-amazonops-superagent', password: 'synthetic-password-for-fixture', port: 0 });
  writeFileSync(join(home, 'settings.json'), settings); writeFileSync(join(target, 'settings.json'), settings);
  writeFileSync(join(target, 'keep.txt'), 'synthetic existing runtime');
  return { base, root, home, target };
}

test('launcher rejects linked homes, ancestors and every existing state subtree before writes or spawn', async t => {
  for (const kind of ['home', 'ancestor', 'dangling-home', 'settings', 'data', 'harness', 'superagent', 'nested', 'state-child']) {
    await t.test(kind, () => {
      const f = fixture(); let home = f.home;
      if (kind === 'home') { home = join(f.base, 'home-link'); symlinkSync(f.target, home, 'junction'); }
      else if (kind === 'dangling-home') { home = join(f.base, 'dangling-link'); symlinkSync(join(f.base, 'absent'), home, 'junction'); }
      else if (kind === 'ancestor') {
        const alias = join(f.base, 'ancestor-link'); symlinkSync(f.base, alias, 'junction'); home = join(alias, 'home');
      } else {
        const path = kind === 'settings' ? join(home, 'settings.json') : kind === 'data' ? join(home, 'data') : kind === 'harness' || kind === 'superagent'
          ? join(home, 'data', kind) : join(home, 'data', 'superagent', 'sessions', 'worker', kind);
        if (kind === 'settings') unlinkSync(path);
        mkdirSync(join(path, '..'), { recursive: true }); symlinkSync(f.target, path, 'junction');
      }
      const before = snapshot(f.base); let spawned = 0;
      const child = new ChildProcess();
      let failure: unknown;
      try {
        start({ root: f.root, env: { AMAZONOPS_HOME: home }, stdout: () => {}, stderr: () => {},
          spawn: () => { spawned++; return child; } });
      } catch (error) { failure = error; }
      child.emit('exit', 0);
      assert.equal(spawned, 0, 'linked home must be refused before spawning a child');
      assert.deepEqual(snapshot(f.base), before, 'neither logical home nor target may change');
      assert.match(String(failure), /RUNTIME_PATH_LINK_FORBIDDEN/);
    });
  }
});

test('standalone settings creation rejects a linked home without writing the target', () => {
  const f = fixture(), alias = join(f.base, 'settings-home-link');
  symlinkSync(f.target, alias, 'junction'); const before = snapshot(f.base);
  assert.throws(() => loadSettings(alias, {}), /RUNTIME_PATH_LINK_FORBIDDEN/);
  assert.deepEqual(snapshot(f.base), before);
});

test('a regular isolated home still launches through the provided native spawn seam', () => {
  const f = fixture(), child = new ChildProcess(); let spawned = 0;
  const result = start({ root: f.root, env: { AMAZONOPS_HOME: f.home }, stdout: () => {}, stderr: () => {},
    spawn: (_command, args, options) => {
      spawned++;
      assert.ok(args.includes('--no-open'));
      assert.equal(options.env?.DSH_HOME, join(f.home, 'data', 'harness'));
      return child;
    } });
  assert.equal(spawned, 1);
  assert.equal(result.home, f.home);
  child.emit('exit', 0);
  assert.equal(readdirSync(f.home).some(name => name.startsWith('launch-')), false);
});
