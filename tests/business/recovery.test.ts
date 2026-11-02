import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { Store } from '../../packages/business/core/store.ts';
import { Learning, type Task } from '../../packages/business/learning/service.ts';
import { ModelBudget } from '../../packages/business/core/budget.ts';
import { createRecoveryPoint, restoreRecoveryPoint } from '../../packages/business/core/recovery.ts';

test('restore of an older database reapplies current deletion and skill revocation ledger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-restore-'));
  const original = join(dir, 'business.sqlite');
  let store = new Store(original);
  let learning = new Learning(store);
  try {
    const source = store.source('a', 'precise amount 100.25 USD');
    const memory = learning.remember('a', source.id, 'amount', '100.25 USD', true)!;
    const task = store.create('a', 'task', {
      title: 'flow',
      status: 'done',
      checklist: ['Check one'],
      checked: [true],
      timeZone: 'UTC',
      sources: [source.id],
      confirmedSuccess: true,
    }) as Task;
    const skill = learning.deriveSkill('a', task.id)!;
    const old = join(dir, 'old.sqlite');
    await backup(store.db, old);
    learning.revoke('a', skill.id);
    learning.deleteSource('a', memory.id);
    store.close();
    copyFileSync(old, original);
    store = new Store(original);
    learning = new Learning(store);
    assert.equal(
      learning.activeSkills('a').length,
      0,
      'old active skill must stay revoked after restore',
    );
    assert.equal(
      learning.context('a').facts.length,
      0,
      'deleted memory must not return after restore',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('complete recovery point detects tampering and retains current privacy decisions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-full-restore-'));
  const data = join(dir, 'data');
  const store = new Store(join(data, 'business.sqlite'));
  const budget = new ModelBudget(join(data, 'model-budget.sqlite'), {
    maxCalls: 6,
    maxInputTokens: 1000,
    maxOutputTokens: 100,
    maxTotalTokens: 1100,
  });
  try {
    const source = store.source('a', 'synthetic fact');
    new Learning(store).remember('a', source.id, 'fact', '100.25 USD', true);
    mkdirSync(join(data, 'harness/a/sessions'), { recursive: true });
    writeFileSync(join(data, 'harness/a/sessions/synthetic.jsonl'), '{"fixture":true}\n');
    const point = await createRecoveryPoint(store, budget, data, join(dir, 'backups'));
    budget.reserve(100, 50);
    new Learning(store).deleteSource('a', source.id);
    const target = join(dir, 'restored');
    assert.equal(
      restoreRecoveryPoint(
        point.directory,
        target,
        store.ledgerPath,
        join(data, 'model-budget.sqlite'),
      ).privacyLedgerReapplied,
      true,
    );
    const restored = new Store(join(target, 'business.sqlite'));
    assert.equal(new Learning(restored).context('a').facts.length, 0);
    restored.close();
    const restoredBudget = new ModelBudget(join(target, 'model-budget.sqlite'), budget.limits);
    try {
      assert.equal(
        restoredBudget.snapshot().calls,
        budget.snapshot().calls,
        'restoring business data must not roll back paid-request accounting',
      );
    } finally {
      restoredBudget.close();
    }
    writeFileSync(join(point.directory, 'harness/a/sessions/synthetic.jsonl'), 'tampered');
    assert.throws(
      () =>
        restoreRecoveryPoint(
          point.directory,
          join(dir, 'tampered'),
          store.ledgerPath,
          join(data, 'model-budget.sqlite'),
        ),
      /HASH_MISMATCH/,
    );
  } finally {
    budget.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restoring an earlier point preserves separate runtime and smoke accounting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-policy-restore-'));
  const data = join(dir, 'data');
  const store = new Store(join(data, 'business.sqlite'));
  const limits = { maxCalls: 1, maxInputTokens: 1000, maxOutputTokens: 100, maxTotalTokens: 1100 };
  const budgetPath = join(data, 'model-budget.sqlite');
  const legacy = new ModelBudget(budgetPath, limits);
  const runtime = new ModelBudget(budgetPath, limits, { account: 'runtime', period: 'daily' });
  const smoke = new ModelBudget(budgetPath, limits, {
    account: 'smoke-20261026-release',
    period: 'lifetime',
  });
  try {
    writeFileSync(store.ledgerPath, '');
    legacy.reserve(10, 5);
    const point = await createRecoveryPoint(store, legacy, data, join(dir, 'points'));
    runtime.reserve(20, 10);
    smoke.reserve(30, 15);
    const restoredPath = join(dir, 'restored');
    restoreRecoveryPoint(point.directory, restoredPath, store.ledgerPath, budgetPath);
    for (const policy of [legacy.policy, runtime.policy, smoke.policy]) {
      const restored = new ModelBudget(join(restoredPath, 'model-budget.sqlite'), limits, policy);
      try {
        assert.equal(restored.snapshot().calls, 1);
        assert.equal(restored.lifetimeSnapshot().calls, 3);
        assert.throws(() => restored.reserve(1, 1), /MODEL_BUDGET_EXHAUSTED/);
      } finally {
        restored.close();
      }
    }
  } finally {
    legacy.close();
    runtime.close();
    smoke.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
