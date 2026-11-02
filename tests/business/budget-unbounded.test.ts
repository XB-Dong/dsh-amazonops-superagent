import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelBudget, parseBudgetLimit } from '../../packages/business/core/budget.ts';

const unbounded = {
  maxCalls: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  maxTotalTokens: null,
};

test('explicit unbounded testing preserves exhausted history and records every later request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-unbounded-'));
  const path = join(dir, 'budget.sqlite');
  let budget: ModelBudget | undefined = new ModelBudget(
    path,
    { maxCalls: 12, maxInputTokens: 120000, maxOutputTokens: 6144, maxTotalTokens: 126144 },
    { account: 'smoke-test', period: 'lifetime' },
  );
  try {
    for (let i = 0; i < 12; i++)
      budget.settle(budget.reserve(10, 10), { inputTokens: 5, outputTokens: 2 });
    assert.equal(budget.exhausted(), true);
    budget.close();
    budget = undefined;
    budget = new ModelBudget(path, unbounded, { account: 'smoke-test', period: 'lifetime' });
    assert.equal(budget.exhausted(), false);
    for (let i = 0; i < 30; i++)
      budget.settle(budget.reserve(100000, 512), { inputTokens: 100000, outputTokens: 100 });
    assert.deepEqual(budget.snapshot(), { calls: 42, inputTokens: 3000060, outputTokens: 3024 });
    assert.equal(budget.exhausted(), false);
  } finally {
    budget?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicitly finite dimension still applies alongside unbounded dimensions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-mixed-limit-'));
  const budget = new ModelBudget(join(dir, 'budget.sqlite'), { ...unbounded, maxCalls: 1 });
  try {
    budget.reserve(100000, 512);
    assert.equal(budget.exhausted(), true);
    assert.throws(() => budget.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
    assert.equal(budget.snapshot().calls, 1);
  } finally {
    budget.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the explicit environment marker removes a limit and malformed values fail closed', () => {
  assert.equal(parseBudgetLimit(undefined, 100), 100);
  assert.equal(parseBudgetLimit('unlimited', 100), null);
  assert.equal(parseBudgetLimit('12', 100), 12);
  for (const value of ['', 'Infinity', 'NaN', '0', '-1', '1.5', '1e6', 'null'])
    assert.throws(() => parseBudgetLimit(value, 100), /INVALID_MODEL_BUDGET/);
});
