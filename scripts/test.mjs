/** Discover all offline test suites and prevent inherited provider credentials. */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suites = ['business', 'client', 'integration', 'native', 'packaging'];
export function testFiles(base, suite = 'all') {
  if (suite !== 'all' && !suites.includes(suite)) throw new Error('Unknown offline suite');
  const chosen = suite === 'all' ? suites : [suite];
  return chosen.flatMap(name => {
    try { return readdirSync(join(base, 'tests', name)).filter(file => file.endsWith('.test.ts')).sort()
      .map(file => join('tests', name, file)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  });
}
export function offlineEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|CI|GITHUB_ACTIONS|NO_COLOR|FORCE_COLOR)$/i.test(key)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = testFiles(root, process.argv[2] ?? 'all');
  if (!files.length) throw new Error('No offline test files found');
  console.log(`Running ${files.length} offline test files serially; no model credentials inherited.`);
  // Upstream source tests use parameter properties; Node's strip-only mode cannot load them.
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--test', '--test-concurrency=1', ...files],
    { cwd: root, stdio: 'inherit', windowsHide: true, env: offlineEnvironment(process.env) });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
