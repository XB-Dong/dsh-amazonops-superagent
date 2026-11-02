import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Business, ModelBudget, createRecoveryPoint, restoreRecoveryPoint } from '../../packages/business/index.ts';

test('requirement exports preserve a full multi-segment requirement ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-requirement-id-'));
  const business = new Business(directory);
  try {
    const feedback = business.command('main', 'feedback', { requestId: 'feedback', text: '改进清单复制' }) as { id: string };
    const change = business.command('main', 'change-confirm', { id: feedback.id, requirementId: 'CC-TASK-COPY-001' }) as { requirementId: string };
    assert.equal(change.requirementId, 'CC-TASK-COPY-001');
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('coordinated business recovery includes native orchestration state and referenced files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-native-recovery-'));
  const business = new Business(directory);
  const budgetPath = join(directory, 'model-budget.sqlite');
  const budget = new ModelBudget(budgetPath, { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  try {
    business.command('main', 'note', { requestId: 'note', title: '记录', content: '内容' });
    for (const folder of ['superagent', 'files']) mkdirSync(join(directory, folder));
    writeFileSync(join(directory, 'superagent', 'state-marker.txt'), 'native-state');
    writeFileSync(join(directory, 'files', 'report.txt'), 'synthetic-report');
    const point = await createRecoveryPoint(business.store, budget, directory, join(directory, 'backups'));
    assert.ok(point.manifest.files.some(file => file.path === 'superagent/state-marker.txt'));
    assert.ok(point.manifest.files.some(file => file.path === 'files/report.txt'));
    const restore = join(directory, 'restored');
    // Restoration requires the current ledger even when this synthetic fixture has no erasures.
    writeFileSync(business.store.ledgerPath, '');
    restoreRecoveryPoint(point.directory, restore, business.store.ledgerPath, budgetPath);
    assert.equal(readFileSync(join(restore, 'superagent', 'state-marker.txt'), 'utf-8'), 'native-state');
    assert.equal(readFileSync(join(restore, 'files', 'report.txt'), 'utf-8'), 'synthetic-report');
  } finally { budget.close(); business.close(); rmSync(directory, { recursive: true, force: true }); }
});
