import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../packages/business/core/store.ts';
import { ModelBudget } from '../../packages/business/core/budget.ts';
import { createRecoveryPoint, restoreRecoveryPoint } from '../../packages/business/core/recovery.ts';

for (const active of [false, true]) test(`recovery reads current budget without changing source bytes or sidecars; active WAL=${active}`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'amazonops-budget-readonly-'));
  const source = join(root, 'source'); mkdirSync(source);
  const store = new Store(join(source, 'business.sqlite'));
  const budgetPath = join(source, 'model-budget.sqlite');
  const budget = new ModelBudget(budgetPath, { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  let budgetClosed = false;
  let storeClosed = false;
  const fingerprint = () => readdirSync(source).sort().map(name => [name,
    createHash('sha256').update(readFileSync(join(source, name))).digest('hex')]);
  try {
    writeFileSync(store.ledgerPath, '');
    const point = await createRecoveryPoint(store, budget, source, join(root, 'backups'));
    const id = budget.reserve(100, 20);
    budget.settle(id, { inputTokens: 80, outputTokens: 12 });
    store.close(); storeClosed = true;
    if (!active) { budget.close(); budgetClosed = true; }
    const before = fingerprint();
    const target = join(root, 'recovered');
    restoreRecoveryPoint(point.directory, target, store.ledgerPath, budgetPath);
    assert.deepEqual(fingerprint(), before, 'Source budget open must not create WAL/SHM or update read marks');
    const restored = new DatabaseSync(join(target, 'model-budget.sqlite'));
    try {
      assert.deepEqual({ ...restored.prepare('SELECT input_tokens,output_tokens,settled,usage_verified FROM model_requests WHERE id=?').get(id) },
        { input_tokens: 80, output_tokens: 12, settled: 1, usage_verified: 1 });
    } finally { restored.close(); }
    assert.ok(!readdirSync(target).some(name => name.startsWith('.current-budget-')), 'Temporary input copies must be removed');
  } finally {
    if (!storeClosed) store.close();
    if (!budgetClosed) budget.close();
    rmSync(root, { recursive: true, force: true });
  }
});
