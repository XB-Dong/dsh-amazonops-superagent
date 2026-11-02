import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offlineEnvironment, testFiles } from '../../scripts/test.mjs';

test('test discovery includes native and packaging gates and rejects unknown suites', () => {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-test-discovery-'));
  for (const name of ['business', 'client', 'integration', 'native', 'packaging']) {
    mkdirSync(join(root, 'tests', name), { recursive: true });
    writeFileSync(join(root, 'tests', name, 'example.test.ts'), '');
  }
  assert.equal(testFiles(root).length, 5);
  assert.equal(testFiles(root, 'native').length, 1);
  assert.throws(() => testFiles(root, '../private'));
});
test('ordinary offline tests cannot inherit model, GitHub, SSH or launcher secrets', () => {
  assert.deepEqual(offlineEnvironment({ PATH: 'tools', CI: 'true', AMAZONOPS_API_KEY: 'synthetic',
    DEEPSEEK_API_KEY: 'synthetic', GITHUB_TOKEN: 'synthetic', SSH_AUTH_SOCK: 'synthetic',
    NODE_OPTIONS: '--require untrusted', DSH_HOME: 'foreign-state' }), { PATH: 'tools', CI: 'true' });
});
