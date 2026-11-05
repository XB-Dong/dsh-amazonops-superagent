/** Explicit paid P1 acceptance with synthetic data. Never discovered by ordinary tests. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { localPatch } from '../profiles/local.ts';
import { scrubEnvironment, lineWriter } from './start.mjs';
import { liveDeliveryProof } from './live-proof.ts';

const key = process.env.AMAZONOPS_API_KEY;
if (!key) throw new Error('AMAZONOPS_API_KEY_REQUIRED');
const root = resolve('.'), home = process.env.AMAZONOPS_P1_LIVE_HOME ?? mkdtempSync(join(tmpdir(), 'amazonops-p1-live-'));
const evidence = join(home, 'evidence'); mkdirSync(evidence,{recursive:true});
const prior=existsSync(join(evidence,'result.json'))?JSON.parse(readFileSync(join(evidence,'result.json'),'utf8')):undefined;
if(prior)writeFileSync(join(evidence,`result-prior-${Date.now()}.json`),JSON.stringify(prior,null,2));
const password = randomBytes(24).toString('base64url');
const socket = createServer(); await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
const origin = `http://127.0.0.1:${port}`, observer = join(root, 'lib/p1-live-observer.js');
await build({ entryPoints: [join(root, 'tests/integration/native-e2e-probe.ts')], outfile: observer,
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
const profile = join(home, 'profile.json');
writeFileSync(profile, JSON.stringify([{ insert: [{ id: 'p1-live-observer', name: observer.replaceAll('\\', '/'), config: { evidence } }] },
  ...localPatch({ root, home, password, port, live: true, modelAccount: 'test', proactiveAutoEnabled: true })]), { mode: 0o600 });
let child: ChildProcess | undefined, cookie = '', logs = '';
const report: any = { home, evidence, origin, phases: [], syntheticData: true, automaticModelRetries: 0, passed: false };
const save = () => writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${origin}/amazonops/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (path === 'login' && response.ok) cookie = response.headers.get('set-cookie')!.split(';')[0];
  if (!response.ok) throw new Error(`HTTP_${response.status}_${(value as any).error ?? 'FAILED'}`);
  return value;
}
const native = (): any => existsSync(join(evidence, 'native-state.json')) ? JSON.parse(readFileSync(join(evidence, 'native-state.json'), 'utf8')) : undefined;
async function until(name: string, check: () => Promise<any>, timeout = 240000): Promise<any> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('NATIVE_HOST_EXITED');
    const value = await check(); if (value) { report.phases.push({ name, at: new Date().toISOString() }); save(); console.log(`P1 live phase passed: ${name}`); return value; }
    const failed = native()?.tickets.find((ticket: any) => ['failed', 'blocked'].includes(ticket.assignments.at(-1)?.report?.state));
    if (failed) throw new Error('LIVE_TICKET_FAILED_OR_BLOCKED');
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error(`${name}_TIMEOUT`);
}
async function current(id: string) { return (await api('work')).tickets.find((ticket: any) => ticket.id === id); }
async function action(id: string, requestId: string, text: string) {
  const accepted=native()?.triggers.find((item:any)=>item.id===`human-work-action-${requestId}`);
  if(accepted){assert.equal(accepted.text,text,'A resumed fixture must preserve the original human intent');
    return {messageId:accepted.id,threadId:accepted.threads[0].id};}
  const ticket = await current(id);
  return api('work-actions', { ticketId: id, requestId, expectedUpdatedAt: ticket.updatedAt,
    action: ticket.attention ? 'answer' : 'supplement', ...(ticket.attention ? { attentionId: ticket.attention.id } : {}), text });
}
function processed(ticketId: string, messageId: string): boolean {
  const ticket = native()?.tickets.find((item: any) => item.id === ticketId), assignment = ticket?.assignments.at(-1);
  const input = ticket?.inputs.find((item: any) => item.kind === 'trigger' && item.triggerId === messageId);
  // Official turn completion can precede the synchronous report timestamp by a
  // millisecond. Both must follow this input; ordering those two clocks is not a gate.
  return !!input?.readAt && !!assignment?.idleAt && assignment.report?.at >= input.at && assignment.idleAt >= input.at;
}
try {
  child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', profile, '--no-open'],
    { cwd: root, env: scrubEnvironment(process.env, home, key), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const writer = lineWriter(chunk => { logs += chunk; writeFileSync(join(evidence, 'host.log'), logs); }, [key, password]);
  child.stdout!.on('data', chunk => writer.push(String(chunk))); child.stderr!.on('data', chunk => writer.push(String(chunk)));
  await until('host-ready', async () => { try { await api('login', { password }); return (await api('status')).live; } catch { return false; } }, 30000);
  const asOf = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const forecast = await api('actions/forecast', { requestId: 'p1-live-initial', store: 'Synthetic', site: 'US', listing: 'A', asOf, manualDaily: 5, manualReason: '合成验收，无真实业务资料' });
  const inventory = await api('actions/inventory', { forecastId: forecast.id, physicalSku: 'A', asOf, available: 12, reserved: 0,
    inbound: [], leadDays: { purchase: 1, transport: 2, receiving: 1 }, safetyDays: 2, horizon: 7, demandFactors: [] });
  const watch = await api('followups/create', { requestId: 'p1-live-watch', inventoryId: inventory.id,
    expiresAt: prior?.watch?.expiresAt??new Date(Date.now() + 3600000).toISOString(), title: 'P1真实模型合成库存跟进' });
  report.watch = watch;
  const first = await until('finite-watch-waiting', async () => (await api('work')).tickets.find((ticket: any) =>
    ticket.watchId === watch.id && ticket.latestReport?.status === 'waiting'));
  const setup = await action(first.id, 'p1-live-instructions', '这是合成验收。现在先等待，不创建新的草稿。下一次库存风险变化时，先通过human_action问我是否生成内部复核清单，得到我明确答复后才创建。若刚才有问题，以上是我的答复，请清除human_action。只允许内部建议，继续waiting跟进。');
  await until('followup-instruction-processed', async () => { const ticket = await current(first.id); return processed(first.id, setup.messageId) && !ticket.attention && ticket.latestReport?.status === 'waiting'; });
  const before = (await api('snapshot')).tasks.length;
  await api('actions/forecast', { requestId: 'p1-live-changed', store: 'Synthetic', site: 'US', listing: 'A', asOf, manualDaily: 8, manualReason: '合成数据变化，验证持续跟进' });
  const asked = await until('business-change-human-attention', async () => { const ticket = await current(first.id); return ticket?.attention ? ticket : false; });
  report.attention = asked.attention;
  const answer = await action(first.id, 'p1-live-choice', '同意生成内部复核清单。先用cc_read_watch读取最新风险，再保存一份待确认任务草稿；清除已回答的human_action，继续waiting跟进，不要结束。');
  await until('answer-draft-live-watch', async () => {
    const ticket = await current(first.id), snapshot = await api('snapshot');
    return processed(first.id, answer.messageId) && !ticket.attention && ticket.latestReport?.status === 'waiting' && snapshot.tasks.length === before + 1;
  });
  assert.equal((await api('followups')).watches.find((item: any) => item.id === watch.id).status, 'active');
  const completion = await action(first.id, 'p1-live-completion', '现在完成跟进。请结束这次合成库存跟进，报告内部草稿已保存、等待人工确认，并把最终结果回复给我。不要执行外部操作。');
  await until('native-final-result-delivered', async () => {
    const state = native(), ticket = state?.tickets.find((item: any) => item.id === first.id), work = await api('work');
    if(ticket?.ended?.outcome!=='completed')return false;
    const events=readFileSync(join(evidence,'session-events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const proof=liveDeliveryProof(work,events,state.outbox,first.source.threadId,watch.sourceId);
    if(proof)report.deliveryProof=proof;
    return proof;
  });
  report.completion = completion;
  await api('followups/rule', { requestId: 'p1-live-observe', mode: 'observe', inventoryIds: [inventory.id] });
  const observed = await until('native-observe-assessment', async () => {
    const state = await api('followups'); return state.assessments?.find((item: any) => item.decision === 'would_accept');
  });
  report.observe = observed;
  const state = native(); assert.equal(state.tickets.length, 1, 'observe must not start a worker');
  const events = readFileSync(join(evidence, 'session-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const calls = events.filter(item => item.event.type === 'tool/call'), results = events.filter(item => item.event.type === 'tool/result');
  for (const name of ['orchestrator_route', 'cc_read_watch', 'cc_prepare_task', 'orchestrator_report', 'orchestrator_reply', 'orchestrator_eval', 'orchestrator_eval_decide'])
    assert.ok(results.some(result => !result.event.data.message.isError && calls.some(call => call.sessionId === result.sessionId &&
      call.event.data.callId === result.event.data.message.toolCallId && call.event.data.name === name)), `Successful native callback missing: ${name}`);
  report.finalWork = await api('work'); report.finalSnapshot = await api('snapshot'); report.finalFollowups = await api('followups');
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : 'LIVE_FAILED'; process.exitCode = 1; }
finally {
  if (child && child.exitCode === null) { if (child.connected) child.send('native-e2e-graceful-stop'); else child.kill();
    await new Promise<void>(done => { child!.once('exit', () => done()); setTimeout(() => { child?.kill(); done(); }, 10000).unref(); }); }
  const db = new DatabaseSync(join(home, 'data/model-budget.sqlite'), { readOnly: true });
  try { report.requests = db.prepare('SELECT * FROM model_requests').all(); report.verifiedRequests = report.requests.filter((item: any) => item.usage_verified === 1).length; }
  finally { db.close(); }
  save(); console.log(JSON.stringify({ evidence, passed: report.passed, phases: report.phases.length, error: report.error ?? null,
    requests: report.requests.length, verifiedRequests: report.verifiedRequests }));
}
