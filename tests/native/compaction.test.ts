import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { buildProject } from '../../scripts/build.mjs';
import { localPatch } from '../../profiles/local.ts';
import { scrubEnvironment, lineWriter } from '../../scripts/start.mjs';
import { fakeModel } from './compaction-model.ts';

test('offline native worker compacts persisted history through CompactionEngine and replays checkpoint after restart', { timeout: 150000 }, async t => {
  const root = resolve('.');
  const home = mkdtempSync(join(tmpdir(), 'amazonops-native-compact-'));
  const evidence = join(home, 'evidence'); mkdirSync(evidence);
  const model = await fakeModel(evidence);
  const password = 'synthetic-compaction-password', key = 'synthetic-compaction-key';
  const allocator = createServer();
  await new Promise<void>(done => allocator.listen(0, '127.0.0.1', done));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>(done => allocator.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined, cookie = '', logs = '';
  await buildProject({ root });
  const probe = join(root, 'lib/compaction-probe.js');
  await build({ entryPoints: [join(root, 'tests/native/compaction-probe.ts')], outfile: probe,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const profile: any[] = localPatch({ root, home, password, port, live: true, modelAccount: 'test' });
  function fixturePolicy(rows: any[]): void {
    for (const row of rows) {
      if (row.id === 'compaction-basic') row.config = { auto: false, retainTokens: 0, headroomTokens: 0,
        maxTokens: 512, compactionRetries: 0, maxOverflowRetries: 0 };
      if (Array.isArray(row.insert)) fixturePolicy(row.insert);
      if (Array.isArray(row.config)) fixturePolicy(row.config);
      if (Array.isArray(row.config?.plugins)) fixturePolicy(row.config.plugins);
    }
  }
  fixturePolicy(profile);
  const patch = join(home, 'profile.json');
  writeFileSync(patch, JSON.stringify([{ insert: [{ id: 'compaction-observer', name: probe.replaceAll('\\', '/'), config: { evidence } }] },
    ...profile, { id: 'llm-deepseek', config: { baseURL: model.url, apiKeyEnv: 'AMAZONOPS_API_KEY' } }]));
  async function api(path: string, body?: unknown) {
    const response = await fetch(`${origin}/amazonops/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000) });
    const value: any = await response.json();
    return { response, value };
  }
  async function until<T>(label: string, predicate: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (existsSync(join(evidence, 'probe-error.json'))) throw new Error(readFileSync(join(evidence, 'probe-error.json'), 'utf8'));
      if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Host exited: ${logs.slice(-7000)}`);
      try { const value = await predicate(); if (value !== undefined) return value; } catch (error) {
        if (String(error).includes('NATIVE_WORKER_FAILED')) throw error;
      }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`${label} timed out; ${home}\n${logs.slice(-7000)}`);
  }
  async function boot() {
    const env = scrubEnvironment(process.env, home, key);
    env.AMAZONOPS_NETWORK_EVIDENCE = join(evidence, 'network.jsonl');
    child = spawn(process.execPath, ['--require', join(root, 'tests/integration/native-e2e-network.cjs'),
      join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const writer = lineWriter((chunk: string) => { logs += chunk; writeFileSync(join(evidence, 'host.log'), logs); }, [password, key]);
    child.stdout!.on('data', chunk => writer.push(String(chunk))); child.stderr!.on('data', chunk => writer.push(String(chunk)));
    await until('login', async () => {
      const { response } = await api('login', { password });
      if (!response.ok) return;
      cookie = response.headers.get('set-cookie')!.split(';')[0]; return true;
    });
    await until('Source ready', async () => (await api('status')).value.live ? true : undefined);
  }
  async function shutdown() {
    const process = child; child = undefined;
    if (!process || process.exitCode !== null) return;
    process.send('native-e2e-graceful-stop');
    await new Promise<void>(done => { process.once('exit', () => done()); setTimeout(() => { process.kill('SIGKILL'); done(); }, 5000).unref(); });
  }
  const events = () => readFileSync(join(evidence, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  try {
    await boot();
    const history = Array.from({length: 45}, (_, index) => `合成历史核验项${index}：核对演示库存样本，未操作外部系统。`).join('\n');
    const submitted = await api('messages', { text: `请创建库存检查任务草稿。关键事实：准备提前量6小时，仓库WH-042；等待cc确认。\n${history}`, requestId: 'compact-origin' });
    assert.equal(submitted.response.status, 200);
    const work = await until('committed worker tool and progress report', async () => {
      const value = (await api('work')).value;
      if (value.tickets.some((row: any) => row.latestReport?.status === 'failed')) throw new Error('NATIVE_WORKER_FAILED');
      const log = existsSync(join(evidence, 'events.jsonl')) ? events() : [];
      return value.tickets.length === 1 && log.some(row => row.sessionId === value.tickets[0].sessionId && row.event.type === 'turn/end') ? value : undefined;
    });
    const before = (await api('snapshot')).value;
    assert.equal(before.tasks.length, 1);
    const task = before.tasks[0], sessionId = work.tickets[0].sessionId;
    child!.send({ kind: 'compact', sessionId });
    const compacted = await until('official durable compaction', async () => existsSync(join(evidence, 'compacted.json'))
      ? JSON.parse(readFileSync(join(evidence, 'compacted.json'), 'utf8')) : undefined);
    assert.ok(compacted.result, 'real backend must replace a useful region rather than no-op');
    const compactedEvents = compacted.inspection.events;
    const checkpoints = compactedEvents.filter((event: any) => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint');
    assert.equal(checkpoints.length, 1);
    const checkpoint = JSON.stringify(checkpoints[0]);
    for (const fact of ['6小时', 'WH-042', task.id, submitted.value.messageId]) assert.ok(checkpoint.includes(fact), `checkpoint lost ${fact}`);
    assert.equal(compactedEvents.filter((event: any) => event.type === 'compaction/start').length, 1);
    assert.equal(compactedEvents.filter((event: any) => event.type === 'compaction/end').length, 1);
    assert.equal((await api('snapshot')).value.tasks.length, 1);
    assert.equal(model.requests.filter(row => row.role === 'compaction').length, 1);
    await shutdown();
    const db = new DatabaseSync(join(home, 'data', 'model-budget.sqlite'), { readOnly: true });
    try {
      const charges = db.prepare('SELECT r.*,a.purpose,a.session_id FROM model_requests r JOIN model_request_attribution a ON a.request_id=r.id').all();
      const charge = charges.filter(row => row.purpose === 'compaction');
      assert.equal(charge.length, 1); assert.equal(charge[0].session_id, sessionId);
      assert.equal(charge[0].usage_verified, 1); assert.equal(charge[0].input_tokens, 100); assert.equal(charge[0].output_tokens, 20);
      assert.equal(charges.length, model.requests.length);
      writeFileSync(join(evidence, 'accounting.json'), JSON.stringify(charges));
    } finally { db.close(); }
    const countBeforeRestart = model.requests.length;
    await boot();
    child!.send({ kind: 'continue', sessionId });
    await until('restarted agent consumed persisted checkpoint', async () => existsSync(join(evidence, 'continued.json')) ? true : undefined);
    const restartedRequests = model.requests.slice(countBeforeRestart);
    assert.equal(restartedRequests.filter(row => row.role === 'continued').length, 1);
    assert.ok(restartedRequests.every(row => ['continued', 'router'].includes(row.role) && !row.tool),
      'a native router status relay may follow the resumed worker; no extra worker operation may execute');
    const after = (await api('snapshot')).value;
    assert.deepEqual(after.tasks, before.tasks);
    const workerEvents = events().filter(row => row.sessionId === sessionId);
    const toolCalls = workerEvents.filter(row => row.event.type === 'tool/call' && row.event.data.name === 'cc_prepare_task');
    assert.equal(toolCalls.length, 1, 'restart and checkpoint must not replay committed model writes');
    assert.equal(new Set(workerEvents.map(row => row.event.seq)).size, workerEvents.length, 'observer must see no duplicated durable event ids');
    const network = readFileSync(join(evidence, 'network.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(network.length > 0 && network.every(row => row.allowed && ['127.0.0.1', 'localhost', '::1'].includes(row.host)));
    await shutdown();
    const finalBudget = new DatabaseSync(join(home, 'data', 'model-budget.sqlite'), { readOnly: true });
    try {
      const charges = finalBudget.prepare('SELECT r.*,a.purpose FROM model_requests r JOIN model_request_attribution a ON a.request_id=r.id').all();
      assert.equal(charges.length, model.requests.length, 'restarted model call must also be durably accounted');
      assert.equal(charges.filter(row => row.purpose === 'compaction').length, 1);
      assert.ok(charges.every(row => row.settled === 1 && row.usage_verified === 1));
      writeFileSync(join(evidence, 'accounting-final.json'), JSON.stringify(charges));
    } finally { finalBudget.close(); }
    t.diagnostic(`Native compaction evidence: ${home}`);
  } finally { await shutdown(); model.server.closeAllConnections(); await new Promise<void>(done => model.server.close(() => done())); }
});
