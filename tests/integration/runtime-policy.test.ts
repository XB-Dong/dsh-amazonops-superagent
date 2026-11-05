import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelBudget } from '../../packages/business/core/budget.ts';
import * as module from '../../packages/host/production.ts';

test('production runtime preserves the approved account, period and limits instead of resetting the day', () => {
  const configured = (module as any).budgetConfiguration({ modelAccount: 'runtime', publicOrigin: 'https://ops.example.test',
    runtimePolicy: { account: 'runtime', period: 'daily' },
    runtimeLimits: { maxCalls: 1, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null } });
  const path = join(mkdtempSync(join(tmpdir(), 'amazonops-runtime-policy-')), 'budget.sqlite');
  const clock = () => Date.parse('2026-11-05T04:00:00Z');
  const old = new ModelBudget(path, configured.limits, configured.policy, clock);
  old.reserve(100, 10); old.close();
  const current = new ModelBudget(path, configured.limits, configured.policy, clock);
  try { assert.equal(current.account(), 'runtime@2026-11-05'); assert.equal(current.snapshot().calls, 1); assert.equal(current.exhausted(), true); }
  finally { current.close(); }
});

test('public production runtime rejects missing or malformed inherited budget protection', () => {
  const configure = (module as any).budgetConfiguration;
  assert.throws(() => configure({ modelAccount: 'runtime', publicOrigin: 'https://ops.example.test' }), /RUNTIME_POLICY_REQUIRED/);
  assert.throws(() => configure({ runtimePolicy: { account: 'invalid/account', period: 'daily' } }), /INVALID_BUDGET_POLICY/);
  assert.throws(() => configure({ runtimeLimits: { maxCalls: -1 } }), /INVALID_MODEL_BUDGET/);
});
