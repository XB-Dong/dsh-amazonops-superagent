import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelBudget } from '../../packages/business/index.ts';
import { installAccounting, type AccountingOptions } from '../../packages/host/accounting.ts';

// Unit scope: actual Cordis waterfall, controlled stream, no provider or native Agent startup.
const usage = { type: 'usage', usage: { inputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 10, outputTokens: 3, totalTokens: 38 } } satisfies StreamChunk;
const finish = { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk;
function request(extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return Object.freeze({ provider: 'synthetic', model: 'test', messages: [], maxTokens: 50, ...extra });
}
function fixture(options: AccountingOptions = { live: true }) {
  const directory = mkdtempSync(join(tmpdir(), 'amazonops-accounting-'));
  const ctx = new Context();
  const budget = new ModelBudget(join(directory, 'usage.sqlite'), { maxCalls: null, maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null });
  const accounting = installAccounting(ctx, budget, options);
  let dispatches = 0;
  const call = async (input: GenerateOptions, chunks: StreamChunk[], failure?: Error) => {
    const stream = ctx.waterfall('llm/stream', input, async function* () {
      dispatches++;
      for (const chunk of chunks) yield chunk;
      if (failure) throw failure;
    }) as AsyncIterable<StreamChunk>;
    const result: StreamChunk[] = [];
    for await (const chunk of stream) result.push(chunk);
    return result;
  };
  return { ctx, budget, accounting, call, dispatches: () => dispatches,
    close() { accounting(); budget.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('unit: verified native usage includes disjoint cache read and write input', async () => {
  const f = fixture();
  try {
    const input = request();
    await f.call(input, [usage, finish]);
    assert.deepEqual(f.budget.snapshot(), { calls: 1, inputTokens: 35, outputTokens: 3 });
    assert.ok(f.accounting.state.lastSuccess);
    assert.equal(input.maxTokens, 50);
  } finally { f.close(); }
});

test('unit: missing usage or terminal finish keeps the durable reservation unknown', async () => {
  const f = fixture();
  try {
    await f.call(request(), [finish]);
    await f.call(request(), [usage]);
    const rows = f.budget.db.prepare('SELECT settled,usage_verified,output_tokens FROM model_requests').all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.settled === 1 && row.usage_verified === 0 && row.output_tokens === 50));
    assert.ok(f.accounting.state.lastFailure);
  } finally { f.close(); }
});

test('unit: failed native calls reserve once and never automatically call next again', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.call(request(), [usage], new Error('SYNTHETIC_FAILURE')), /SYNTHETIC_FAILURE/);
    assert.equal(f.dispatches(), 1);
    assert.equal(f.budget.snapshot().calls, 1);
    assert.equal(f.budget.db.prepare('SELECT usage_verified FROM model_requests').get()?.usage_verified, 0);
  } finally { f.close(); }
});

test('unit: offline mode denies before dispatch or a billed reservation and can be enabled explicitly', async () => {
  const f = fixture({ live: false });
  try {
    await assert.rejects(f.call(request(), [usage, finish]), /MODEL_OFFLINE/);
    assert.equal(f.dispatches(), 0);
    assert.equal(f.budget.snapshot().calls, 0);
    f.accounting.setLive(true);
    await f.call(request(), [usage, finish]);
    assert.equal(f.budget.snapshot().calls, 1);
  } finally { f.close(); }
});

test('unit: routing, worker, title and compaction calls all pass through the same ledger', async () => {
  const f = fixture();
  try {
    for (const extra of [{ sessionId: 'main' }, { sessionId: 'worker' }, { sessionId: 'worker', purpose: 'session-title' }, { sessionId: 'worker', purpose: 'compaction' }])
      await f.call(request(extra as Partial<GenerateOptions>), [usage, finish]);
    assert.equal(f.budget.snapshot().calls, 4);
    assert.equal(f.budget.snapshot().inputTokens, 140);
    const purposes = f.budget.db.prepare('SELECT purpose FROM model_request_attribution ORDER BY rowid').all();
    assert.deepEqual(purposes.map(row => row.purpose), ['conversation', 'conversation', 'session-title', 'compaction']);
  } finally { f.close(); }
});

test('unit: per-turn guard counts auxiliary calls in the open native turn and resets on a new turn', async () => {
  const f = fixture({ live: true, maxRequestsPerTurn: 2 });
  const session = { id: 'worker' } as never;
  try {
    f.ctx.emit('session/event', session, { type: 'turn/start', seq: 1 } as never);
    await f.call(request({ sessionId: 'worker' as never }), [usage, finish]);
    await f.call(request({ sessionId: 'worker' as never, purpose: 'compaction' }), [usage, finish]);
    await assert.rejects(f.call(request({ sessionId: 'worker' as never }), [usage, finish]), /MODEL_TURN_LIMIT/);
    assert.equal(f.dispatches(), 2);
    f.ctx.emit('session/event', session, { type: 'turn/end', seq: 7 } as never);
    f.ctx.emit('session/event', session, { type: 'turn/start', seq: 8 } as never);
    await f.call(request({ sessionId: 'worker' as never }), [usage, finish]);
    assert.equal(f.budget.snapshot().calls, 3);
  } finally { f.close(); }
});

test('unit: native cancellation keeps an uncertain reservation and does not mutate frozen options', async () => {
  const f = fixture();
  const controller = new AbortController();
  try {
    const input = request({ signal: controller.signal });
    const stream = f.ctx.waterfall('llm/stream', input, async function* () {
      await new Promise(resolve => setTimeout(resolve, 30));
      yield usage; yield finish;
    }) as AsyncIterable<StreamChunk>;
    const consume = (async () => { for await (const _chunk of stream) {} })();
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(consume, /MODEL_CANCELLED/);
    assert.equal(input.signal, controller.signal);
    assert.equal(f.budget.db.prepare('SELECT usage_verified FROM model_requests').get()?.usage_verified, 0);
    assert.equal(f.accounting.state.activeRequests, 0);
  } finally { f.close(); }
});

test('unit: disposal settles every active request conservatively without waiting on an uncooperative adapter', async () => {
  const f = fixture();
  try {
    const stream = f.ctx.waterfall('llm/stream', request(), async function* () {
      await new Promise(resolve => setTimeout(resolve, 30));
      yield usage; yield finish;
    }) as AsyncIterable<StreamChunk>;
    const consume = (async () => { for await (const _chunk of stream) {} })();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.accounting.state.activeRequests, 1);
    f.accounting();
    assert.equal(f.accounting.state.activeRequests, 0);
    await assert.rejects(consume, /ACCOUNTING_STOPPED/);
    assert.equal(f.budget.db.prepare('SELECT settled,usage_verified FROM model_requests').get()?.settled, 1);
    assert.equal(f.budget.db.prepare('SELECT settled,usage_verified FROM model_requests').get()?.usage_verified, 0);
  } finally { f.close(); }
});

test('unit: invalid cached usage and incomplete terminal streams never create verified zero usage', async () => {
  const f = fixture();
  try {
    await f.call(request(), [{ type: 'usage', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: -1 } }, finish]);
    await f.call(request(), [{ type: 'usage', usage: { inputTokens: 5, outputTokens: 1, totalTokens: 1000 } }, finish]);
    const rows = f.budget.db.prepare('SELECT output_tokens,usage_verified FROM model_requests').all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.usage_verified === 0 && row.output_tokens === 50));
  } finally { f.close(); }
});

test('unit: middleware timeout closes consumption, preserves unknown usage and never retries', async () => {
  const f = fixture({ live: true, timeoutMs: 5 });
  try {
    let dispatches = 0;
    const stream = f.ctx.waterfall('llm/stream', request(), async function* () {
      dispatches++;
      await new Promise(resolve => setTimeout(resolve, 30));
      yield usage; yield finish;
    }) as AsyncIterable<StreamChunk>;
    await assert.rejects(async () => { for await (const _chunk of stream) {} }, /MODEL_TIMEOUT/);
    assert.equal(dispatches, 1);
    assert.equal(f.budget.db.prepare('SELECT usage_verified FROM model_requests').get()?.usage_verified, 0);
    assert.equal(f.accounting.state.activeRequests, 0);
  } finally { f.close(); }
});

test('unit: an already cancelled call is denied before reservation or dispatch', async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  try {
    await assert.rejects(f.call(request({ signal: controller.signal }), [usage, finish]), /MODEL_CANCELLED/);
    assert.equal(f.dispatches(), 0);
    assert.equal(f.budget.snapshot().calls, 0);
  } finally { f.close(); }
});

test('unit: a native error finish never converts earlier usage into a verified success', async () => {
  const f = fixture();
  try {
    const failure = { type: 'finish', reason: { kind: 'error', failure: { code: 'SYNTHETIC_FAILURE', message: 'Synthetic failure' } } } as StreamChunk;
    await f.call(request(), [usage, failure]);
    assert.equal(f.dispatches(), 1);
    assert.equal(f.budget.db.prepare('SELECT usage_verified FROM model_requests').get()?.usage_verified, 0);
    assert.ok(f.accounting.state.lastFailure);
    assert.equal(f.accounting.state.lastSuccess, undefined);
  } finally { f.close(); }
});
