/** Test-only plugin for observing a real native host; never included in production profiles. */
import type { Context } from '@deepseek-ai/cordis';
import { Config, machineOf, Runtime } from '../../vendor/superagent/src/extension.ts';

export { Config };
export const inject = ['agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry',
  'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'llm', 'subprocess'];
export async function apply(ctx: Context, config: ReturnType<typeof Config>) {
  const runtime = new Runtime(ctx, machineOf(config), () => {});
  ctx.effect(() => () => runtime.stop());
  let ready = false;
  let failed: string | undefined;
  let guardVerified = false;
  let automaticModelRetries = -1;
  void runtime.ready.then(async () => {
    const master = ctx.agents.get(runtime.masterId as never)!;
    let executed = false;
    const release = master.ctx.tools.register({ name: 'bash', description: 'Forbidden policy probe',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: async () => { executed = true; return {}; } });
    try {
      const outcome = await master.ctx.tools.execute({ callId: 'native-guard-probe' as never, name: 'bash',
        arguments: {}, agent: master, signal: new AbortController().signal });
      guardVerified = outcome.isError && !executed;
    } finally { release(); }
    const retryProbe = runtime.executor as unknown as { retries(key: string, error: unknown): boolean };
    automaticModelRetries = Number(retryProbe.retries('native-probe', { status: 503 }));
    ready = true;
  }).catch(error => { failed = String(error); });
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/native-probe', handler: (_req, res) => {
    const master = ctx.agents.get(runtime.masterId as never);
    try {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ready, failed, configured: runtime.configured(), mode: runtime.machine.executionMode,
      engine: runtime.engine.constructor.name, store: runtime.store.constructor.name,
      executor: runtime.executor.constructor.name, masterId: runtime.masterId,
      masterPreset: master?.session.header.agentPreset,
      permission: master?.session.snapshotEvents().filter(event => event.type === 'permission/preset').at(-1)?.data,
      guardVerified, automaticModelRetries,
      tools: master ? master.ctx.tools.schemas(master).map(tool => tool.name) : [],
      health: runtime.health.runtime }));
    } catch (error) {
      const candidate = master && master.ctx.tools.get('orchestrator_read', master);
      res.end(JSON.stringify({ failed: String(error), parameters: candidate?.parameters,
        parameterKeys: candidate?.parameters && Reflect.ownKeys(candidate.parameters),
        parameterPrototype: candidate?.parameters && Object.getPrototypeOf(candidate.parameters)?.constructor?.name }));
    }
  } }));
  await runtime.ready;
}
