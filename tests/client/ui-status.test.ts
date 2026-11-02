import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, canChat, assistantHealthy, errorMessage, type Status } from '../../packages/client/api.ts';

const status = (modelState: string, extra: Partial<Status> = {}): Status => ({
  authenticated: true,
  live: true,
  modelState,
  scope: 'synthetic',
  budget: {
    used: { calls: 6, inputTokens: 100, outputTokens: 10 },
    limits: { maxCalls: 6, maxTotalTokens: 1000 },
  },
  ...extra,
});

test('configured live access does not enable sending or a healthy indicator after exhaustion', () => {
  assert.equal(canChat(status('budget_exhausted')), false);
  assert.equal(canChat(status('maintenance')),false);
  assert.equal(assistantHealthy(status('budget_exhausted')), false);
  assert.equal(canChat(undefined), false);
  assert.equal(canChat(status('disabled', { live: false })), false);
  assert.equal(canChat(status('last_failed')), true);
  assert.equal(assistantHealthy(status('last_failed')), false);
  assert.equal(assistantHealthy(status('last_succeeded')), true);
  assert.equal(assistantHealthy(status('last_succeeded', { syntheticModel: true })), false);
});

test('unknown service errors do not expose internal codes or server paths', () => {
  for (const value of ['SYNTHETIC_PRIVATE_ERROR', '/var/lib/private/example', 'INTERNAL_ERROR']) {
    const text = errorMessage(value);
    assert.match(text, /[\u4e00-\u9fff]/);
    assert.equal(text.includes(value), false);
  }
});

test('transport failures and non-JSON proxy responses become readable Chinese errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      api('status'),
      (error: unknown) =>
        error instanceof Error &&
        /[\u4e00-\u9fff]/.test(error.message) &&
        !error.message.includes('fetch'),
    );
    globalThis.fetch = async () => new Response('<html>upstream failed</html>', { status: 502 });
    await assert.rejects(
      api('status'),
      (error: unknown) =>
        error instanceof Error &&
        /[\u4e00-\u9fff]/.test(error.message) &&
        !error.message.includes('JSON'),
    );
  } finally {
    globalThis.fetch = original;
  }
});
