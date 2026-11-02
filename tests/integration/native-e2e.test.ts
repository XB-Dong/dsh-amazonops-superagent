import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { buildProject } from '../../scripts/build.mjs';
import { localPatch } from '../../profiles/local.ts';
import { scrubEnvironment, lineWriter } from '../../scripts/start.mjs';
import { fakeModel, draftTitle, draftChecklist, resultText } from './native-e2e-model.ts';

test('fixture network fence denies non-loopback fetch, HTTP and raw socket before connection', () => {
  const home = mkdtempSync(join(tmpdir(), 'amazonops-native-fence-'));
  const evidence = join(home, 'network.jsonl');
  const fixture = resolve('tests/integration/native-e2e-network.cjs');
  const child = spawnSync(process.execPath, ['--require', fixture, '-e', `
    const attempts = [()=>fetch('https://example.invalid/messages'),
      ()=>require('node:https').request('https://example.invalid/messages'),
      ()=>require('node:net').connect({host:'203.0.113.10',port:443})];
    for (const attempt of attempts) {
      let denied=false; try { attempt(); } catch(error) { denied=error.message==='E2E_EXTERNAL_NETWORK_FORBIDDEN'; }
      if(!denied)throw new Error('Fence failed to reject an external address synchronously');
    }
  `], { env: { ...scrubEnvironment(process.env, home), AMAZONOPS_NETWORK_EVIDENCE: evidence },
    windowsHide: true, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  const rows = readFileSync(evidence, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.layer), ['fetch', 'http', 'socket']);
  assert.ok(rows.every(row => row.allowed === false));
});

test('offline real DSH routes, executes scoped task tool, reports and delivers exactly once, then restores', { timeout: 150000 }, async t => {
  const root = resolve('.');
  const home = mkdtempSync(join(tmpdir(), 'amazonops-native-e2e-'));
  const evidence = join(home, 'evidence'); mkdirSync(evidence);
  const model = await fakeModel(evidence);
  let child: ChildProcess | undefined;
  let logs = '';
  let cookie = '';
  const password = 'synthetic-local-fixture-password';
  const key = 'synthetic-local-fixture-key';
  const socket = createServer();
  await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(done => socket.close(() => done()));
  assert.ok(port > 4315);
  const origin = `http://127.0.0.1:${port}`;
  const networkEvidence = join(evidence, 'network.jsonl');
  writeFileSync(networkEvidence, '');
  const manifest = await buildProject({ root });
  const probe = join(root, 'lib/native-e2e-probe.js');
  await build({ entryPoints: [join(root, 'tests/integration/native-e2e-probe.ts')], outfile: probe,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
  const patch = join(home, 'profile.json');
  writeFileSync(patch, JSON.stringify([
    { insert: [{ id: 'native-e2e-observer', name: probe.replaceAll('\\', '/'), config: { evidence } }] },
    ...localPatch({ root, home, password, port, live: true, modelAccount: 'test' }),
    { id: 'llm-deepseek', config: { baseURL: model.url, apiKeyEnv: 'AMAZONOPS_API_KEY' } },
  ]));
  async function api(path: string, body?: unknown) {
    const response = await fetch(`${origin}/amazonops/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin, ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
    const value = await response.json() as any;
    return { response, value };
  }
  async function until<T>(name: string, predicate: () => Promise<T | undefined>, ms = 45000): Promise<T> {
    const deadline = Date.now() + ms;
    let last: unknown;
    while (Date.now() < deadline) {
      if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Host exited: ${logs.slice(-6000)}`);
      try { const value = await predicate(); if (value !== undefined) return value; } catch (error) {
        if (String(error).includes('NATIVE_WORKER_FAILED')) throw error;
        last = String(error);
      }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`${name} timed out: ${last ?? ''}\nRequests=${JSON.stringify(model.requests)}\n${logs.slice(-6000)}\nEvidence=${home}`);
  }
  async function boot() {
    const environment = scrubEnvironment(process.env, home, key);
    environment.AMAZONOPS_NETWORK_EVIDENCE = networkEvidence;
    child = spawn(process.execPath, ['--require', join(root, 'tests/integration/native-e2e-network.cjs'),
      join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open'],
    { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const writer = lineWriter((chunk: string) => { logs += chunk; writeFileSync(join(evidence, 'host.log'), logs); }, [password, key]);
    child.stdout!.on('data', chunk => writer.push(String(chunk)));
    child.stderr!.on('data', chunk => writer.push(String(chunk)));
    await until('login', async () => {
      const { response } = await api('login', { password });
      if (!response.ok) return;
      cookie = response.headers.get('set-cookie')!.split(';')[0];
      return true;
    });
    await until('native Source registration', async () => (await api('status')).value.live ? true : undefined);
  }
  async function shutdown() {
    const process = child; child = undefined;
    if (!process || process.exitCode !== null) return;
    if (process.connected) process.send('native-e2e-graceful-stop'); else process.kill();
    await new Promise<void>(done => { process.once('exit', () => done()); setTimeout(() => { process.kill('SIGKILL'); done(); }, 5000).unref(); });
  }
  try {
    await boot();
    const input = { text: '请创建库存检查任务草稿，包含核对合成库存报表和由cc确认后执行。', requestId: 'offline-e2e-request-1' };
    const submitted = await api('messages', input);
    assert.equal(submitted.response.status, 200, JSON.stringify(submitted.value));
    const duplicate = await api('messages', input);
    assert.deepEqual(duplicate.value, submitted.value);
    const conflict = await api('messages', { ...input, text: '不同请求不得覆盖原请求' });
    assert.equal(conflict.response.status, 409);
    const work = await until('native report and channel delivery', async () => {
      const { value } = await api('work');
      const failed = value.tickets?.find((ticket: any) => ticket.latestReport?.status === 'failed');
      if (failed) throw new Error(`NATIVE_WORKER_FAILED ${JSON.stringify(failed)}; evidence=${home}`);
      if (value.tickets?.some((ticket: any) => ticket.latestReport?.status === 'ready') &&
          value.messages?.some((message: any) => message.role === 'assistant' && message.text === resultText)) return value;
    });
    assert.equal(work.tickets.length, 1);
    assert.equal(work.messages.filter((message: any) => message.role === 'user').length, 1);
    assert.equal(work.messages.filter((message: any) => message.text === resultText).length, 1);
    const snapshot = (await api('snapshot')).value;
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0].title, draftTitle);
    assert.equal(snapshot.tasks[0].status, 'draft');
    assert.deepEqual(snapshot.tasks[0].checklist, draftChecklist);
    assert.deepEqual(snapshot.tasks[0].sources, [submitted.value.messageId]);
    const native = await until('read-only native snapshot', async () => {
      const value = JSON.parse(readFileSync(join(evidence, 'native-state.json'), 'utf8'));
      return value.outbox.some((row: any) => row.text === resultText && row.status === 'sent') ? value : undefined;
    });
    assert.deepEqual([native.engine, native.store, native.executor], ['Engine', 'Store', 'DshExecutor']);
    assert.equal(native.triggers.length, 1);
    // Native origin acceptance links through decisionId; fanout is for later thread inputs.
    assert.equal(native.dispositions[0].value.decisionId, native.tickets[0].decisionId);
    assert.equal(native.decisions.find((decision: any) => decision.id === native.tickets[0].decisionId).kind, 'accept');
    assert.equal(native.tickets[0].id, work.tickets[0].id);
    assert.equal(native.tickets[0].assignments.at(-1).report.state, 'ready');
    const events = readFileSync(join(evidence, 'session-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const calls = events.filter(row => row.event.type === 'tool/call');
    const results = events.filter(row => row.event.type === 'tool/result').map(row => ({ ...row,
      tool: calls.find(call => call.sessionId === row.sessionId && call.event.data.callId === row.event.data.message.toolCallId)?.event.data.name }));
    writeFileSync(join(evidence, 'tool-results.json'), JSON.stringify(results, null, 2));
    for (const name of ['orchestrator_route', 'cc_prepare_task', 'orchestrator_report', 'orchestrator_reply']) {
      assert.ok(model.requests.some(request => request.tool === name), `Real model request did not invoke ${name}`);
      assert.equal(results.filter(row => row.tool === name && row.event.data.message.isError !== true).length, 1,
        `Exactly one successful native callback required for ${name}`);
    }
    const prepareResult = results.find(row => row.tool === 'cc_prepare_task');
    assert.match(prepareResult.sessionId, /^worker-/);
    assert.ok(JSON.stringify(prepareResult.event.data.message).includes(snapshot.tasks[0].id));
    const status = (await api('status')).value;
    assert.equal(status.modelState, 'last_succeeded');
    assert.equal(status.budget.policy.account, 'amazonops-test');
    writeFileSync(join(evidence, 'acceptance.json'), JSON.stringify({ manifest, submitted: submitted.value, work, snapshot, status,
      fixtureRequests: model.requests, nativeTypes: [native.engine, native.store, native.executor], resultEvents: results.length }, null, 2));
    await shutdown();
    await boot();
    const restored = (await api('snapshot')).value;
    const restoredWork = (await api('work')).value;
    assert.equal(restored.tasks.length, 1);
    assert.equal(restored.tasks[0].id, snapshot.tasks[0].id);
    assert.equal(restoredWork.tickets[0].id, work.tickets[0].id);
    assert.equal(restoredWork.messages.filter((message: any) => message.text === resultText).length, 1);
    const replay = await api('messages', input);
    assert.deepEqual(replay.value, submitted.value);
    await new Promise(done => setTimeout(done, 500));
    assert.equal((await api('snapshot')).value.tasks.length, 1);
    assert.equal(model.requests.length, 6, 'A duplicate request or restored ready ticket must not invoke the model again');
    // A second real authenticated message creates a distinct native ticket. Hold only
    // its local model stream, then cancel through the public business endpoint.
    model.control.holdWorkers = true;
    const second = await api('messages', { text: '请创建第二份合成库存草稿，用于取消验收。', requestId: 'offline-e2e-request-2' });
    assert.equal(second.response.status, 200);
    const cancellable = await until('new message native worker generation', async () => {
      const value = (await api('work')).value;
      const ticket = value.tickets.find((row: any) => row.id !== work.tickets[0].id);
      return ticket && model.control.activeWorkers === 1 ? ticket : undefined;
    });
    const cancel = await api('cancel', { ticketId: cancellable.id });
    assert.equal(cancel.response.status, 200);
    const stopped = await until('native cancellation and local stream abort', async () => {
      const value = (await api('work')).value;
      return value.tickets.some((row: any) => row.id === cancellable.id && row.status === 'stopped') &&
        model.control.abortedWorkers === 1 ? value : undefined;
    });
    assert.equal(stopped.tickets.length, 2);
    assert.equal((await api('snapshot')).value.tasks.length, 1, 'Cancelled worker must not save a second draft');
    const afterCancel = (await api('status')).value;
    assert.equal(afterCancel.budget.used.calls, model.requests.length, 'Every fixture stream must be durably accounted, including cancellation');
    writeFileSync(join(evidence, 'restart-cancellation.json'), JSON.stringify({ restoredWork, replay: replay.value,
      second: second.value, stopped, abortedWorkers: model.control.abortedWorkers, status: afterCancel }, null, 2));
    const network = readFileSync(networkEvidence, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(network.length > 0, 'Network fence must observe real model connections');
    assert.ok(network.every(row => row.allowed), 'Any external network attempt fails acceptance');
    assert.ok(network.some(row => row.layer === 'fetch'), 'Real provider must reach the local SSE fixture');
    t.diagnostic(`Native evidence: ${home}; model requests=${model.requests.length}; tool results=${results.length}; external network attempts=0`);
  } finally {
    await shutdown();
    model.server.closeAllConnections();
    await new Promise<void>(done => model.server.close(() => done()));
    if (!existsSync(join(evidence, 'acceptance.json'))) t.diagnostic(`Failed native evidence: ${home}`);
  }
});
