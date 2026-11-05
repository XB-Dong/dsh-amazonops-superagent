import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, resolveDeployment, type Machine } from '../../vendor/superagent/src/deployment.ts';
import { BUSINESS_TOOLS, modelRetryLimit, operationToolAllowed } from '../../vendor/superagent/src/operations.ts';

test('native configuration accepts absolute Windows state paths', () => {
  const config = Config({ stateDir: 'D:/synthetic-state' });
  assert.equal(config.stateDir, 'D:/synthetic-state');
});

test('operations role cannot acquire developer or policy editing capabilities', () => {
  assert.equal(BUSINESS_TOOLS.length, 10);
  for (const name of ['bash', 'pwsh', 'write', 'read', 'subagent', 'orchestrator_settings_save', 'orchestrator_prompts_save']) {
    assert.equal(operationToolAllowed(name, 'orchestrator'), false);
    assert.equal(operationToolAllowed(name, 'worker'), false);
  }
  assert.equal(operationToolAllowed('cc_copy_task', 'worker'), true);
  assert.equal(operationToolAllowed('cc_copy_task', 'orchestrator'), false);
});

test('operations never automatically retries model failures', () => {
  assert.equal(modelRetryLimit({ executionMode: 'operations' }), 0);
  assert.equal(modelRetryLimit({ executionMode: 'development' }), 3);
});

test('operations deployment never probes GitHub credentials or CLI', async () => {
  let probes = 0;
  const machine = { stateDir: 'D:/synthetic-state', executionMode: 'operations',
    promptMaxChars: { get: () => 100000 }, admissionContextMaxPages: { get: () => 10 },
    admissionContextTimeoutMs: { get: () => 15000 } } as unknown as Machine;
  const deployment = await resolveDeployment(machine, undefined, async () => {
    probes++;
    throw new Error('credential access forbidden');
  });
  assert.equal(deployment.executionMode, 'operations');
  assert.equal(probes, 0);
  assert.equal(deployment.repository, '');
});
