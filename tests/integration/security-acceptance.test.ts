import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline boundary acceptance: actual storage/recovery functions, synthetic data only.
const root = resolve(process.env.AMAZONOPS_REVIEW_ROOT ?? process.cwd());
const { Business, ModelBudget, createRecoveryPoint, restoreRecoveryPoint } =
  await import(pathToFileURL(join(root, 'packages/business/index.ts')).href);
const { allowedRequest } = await import(pathToFileURL(join(root, 'packages/host/boundary.ts')).href);
const { Auth } = await import(pathToFileURL(join(root, 'packages/host/auth.ts')).href);

for (const linkLocation of ['backup-root', 'manifest-parent'] as const)
  test(`offline acceptance: restore rejects ${linkLocation} junction even when all hashes match`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amazonops-recovery-security-'));
    const data = join(dir, 'data');
    const business = new Business(data);
    const budgetPath = join(data, 'model-budget.sqlite');
    const budget = new ModelBudget(budgetPath,
      { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
    try {
      mkdirSync(join(data, 'harness'), { recursive: true });
      writeFileSync(join(data, 'harness', 'synthetic-session.json'), '{"synthetic":true}');
      writeFileSync(business.store.ledgerPath, '');
      const point = await createRecoveryPoint(business.store, budget, data, join(dir, 'backups'));
      let input = point.directory;
      if (linkLocation === 'backup-root') {
        input = join(dir, 'linked-backup');
        symlinkSync(point.directory, input, 'junction');
      } else {
        const outside = join(dir, 'outside-backup');
        renameSync(join(point.directory, 'harness'), outside);
        symlinkSync(outside, join(point.directory, 'harness'), 'junction');
      }
      const target = join(dir, 'restored');
      assert.throws(() => restoreRecoveryPoint(input, target, business.store.ledgerPath, budgetPath), /SYMLINK|LINK_FORBIDDEN/);
      assert.equal(existsSync(target), false, 'reject before creating a usable restore directory');
    } finally { budget.close(); business.close(); rmSync(dir, { recursive: true, force: true }); }
  });

test('unit acceptance: malformed HTTP request target fails closed without escaping the ingress listener', () => {
  const auth = new Auth('synthetic-boundary-password');
  let status: number | undefined;
  assert.doesNotThrow(() => {
    status = allowedRequest({ method: 'GET', url: 'http://[', headers: { host: '127.0.0.1:3456' } },
      'http://127.0.0.1:3456', auth);
  });
  assert.ok(status === 400 || status === 401 || status === 403);
});

for (const missing of ['business.sqlite', 'model-budget.sqlite'])
  test(`offline acceptance: a manifest missing ${missing} is rejected before restore creates an empty replacement`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amazonops-missing-backup-db-'));
    const data = join(dir, 'data');
    const business = new Business(data);
    const budgetPath = join(data, 'model-budget.sqlite');
    const budget = new ModelBudget(budgetPath,
      { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
    try {
      business.store.source('main', '这条业务数据不能在恢复时被静默丢失');
      writeFileSync(business.store.ledgerPath, '');
      const point = await createRecoveryPoint(business.store, budget, data, join(dir, 'backups'));
      const manifestPath = join(point.directory, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.files = manifest.files.filter((file: { path: string }) => file.path !== missing);
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const target = join(dir, 'restored');
      assert.throws(() => restoreRecoveryPoint(point.directory, target, business.store.ledgerPath, budgetPath), /BACKUP_DATABASE_REQUIRED/);
      assert.equal(existsSync(target), false);
    } finally { budget.close(); business.close(); rmSync(dir, { recursive: true, force: true }); }
  });
