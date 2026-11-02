import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelBudget } from '../../packages/business/core/budget.ts';

const limits = { maxCalls: 2, maxInputTokens: 100, maxOutputTokens: 40, maxTotalTokens: 120 };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-budget-'));
  return {
    path: join(dir, 'budget.sqlite'),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
test('shared durable reservations block a competing caller before sending', () => {
  const f = fixture();
  const a = new ModelBudget(f.path, limits);
  const b = new ModelBudget(f.path, limits);
  try {
    a.reserve(70, 20);
    assert.throws(() => b.reserve(40, 10), /MODEL_BUDGET_EXHAUSTED/);
    assert.equal(b.snapshot().calls, 1);
  } finally {
    a.close();
    b.close();
    f.dispose();
  }
});
test('missing usage retains reservation after restart; each retry counts', () => {
  const f = fixture();
  let budget = new ModelBudget(f.path, limits);
  try {
    const id = budget.reserve(30, 10);
    budget.settle(id);
    budget.close();
    budget = new ModelBudget(f.path, limits);
    assert.deepEqual(budget.snapshot(), { calls: 1, inputTokens: 30, outputTokens: 10 });
    budget.reserve(30, 10);
    assert.throws(() => budget.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
  } finally {
    budget.close();
    f.dispose();
  }
});
test('verified usage releases only unused tokens, settlement is idempotent', () => {
  const f = fixture();
  const budget = new ModelBudget(f.path, limits);
  try {
    const id = budget.reserve(60, 30);
    budget.settle(id, { inputTokens: 20, outputTokens: 5 });
    budget.settle(id, { inputTokens: 0, outputTokens: 0 });
    assert.deepEqual(budget.snapshot(), { calls: 1, inputTokens: 20, outputTokens: 5 });
    assert.throws(() => budget.reserve(-1, 1), /INVALID_TOKEN_RESERVATION/);
    assert.throws(
      () => new ModelBudget(f.path, { ...limits, maxCalls: 0 }),
      /INVALID_MODEL_BUDGET/,
    );
  } finally {
    budget.close();
    f.dispose();
  }
});
