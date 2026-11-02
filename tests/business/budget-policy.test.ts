import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelBudget } from '../../packages/business/core/budget.ts';

const limits = { maxCalls: 1, maxInputTokens: 100, maxOutputTokens: 40, maxTotalTokens: 140 };
test('an exhausted pre-policy ledger is retained without blocking runtime or the new smoke allocation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-budget-policy-'));
  const path = join(dir, 'budget.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE model_requests (id TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0,
    usage_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO model_requests VALUES ('historic',20,5,1,1,'2026-10-25 10:00:00');`);
  old.close();
  const runtime = new ModelBudget(path, limits, { account: 'runtime', period: 'daily' });
  const smoke = new ModelBudget(path, limits, {
    account: 'smoke-20261026-release',
    period: 'lifetime',
  });
  const legacy = new ModelBudget(path, limits);
  try {
    assert.equal(runtime.snapshot().calls, 0);
    assert.equal(smoke.snapshot().calls, 0);
    assert.equal(legacy.snapshot().calls, 1);
    runtime.reserve(10, 10);
    smoke.reserve(10, 10);
    assert.throws(() => runtime.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
    assert.throws(() => smoke.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
    assert.equal(runtime.lifetimeSnapshot().calls, 3);
    assert.equal(legacy.snapshot().calls, 1);
  } finally {
    runtime.close();
    smoke.close();
    legacy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily limits follow the Beijing day and settlement stays on the reservation day', () => {
  let now = Date.parse('2026-10-26T15:59:59Z');
  const budget = new ModelBudget(
    ':memory:',
    limits,
    { account: 'runtime', period: 'daily' },
    () => now,
  );
  try {
    const previous = budget.reserve(30, 20);
    assert.throws(() => budget.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
    now = Date.parse('2026-10-26T16:00:00Z');
    assert.equal(budget.snapshot().calls, 0);
    budget.settle(previous, { inputTokens: 15, outputTokens: 5 });
    assert.equal(budget.snapshot().calls, 0);
    budget.reserve(20, 10);
    assert.equal(budget.snapshot().calls, 1);
    assert.equal(budget.lifetimeSnapshot().calls, 2);
    now = Date.parse('2026-10-26T15:59:59Z');
    assert.deepEqual(budget.snapshot(), { calls: 1, inputTokens: 15, outputTokens: 5 });
    assert.throws(() => budget.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
  } finally {
    budget.close();
  }
});

test('invalid budget policies fail closed instead of silently starting a new allowance', () => {
  assert.throws(
    () => new ModelBudget(':memory:', limits, { account: '../runtime', period: 'daily' }),
    /INVALID_BUDGET_POLICY/,
  );
  assert.throws(
    () => new ModelBudget(':memory:', limits, { account: 'runtime', period: 'weekly' as 'daily' }),
    /INVALID_BUDGET_POLICY/,
  );
});
