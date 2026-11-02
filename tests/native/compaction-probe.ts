/** Test-only controller: every mutation delegates to an official native public service. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-session-persistence';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const inject = ['sessionController', 'sessionPersistence', 'agents'];
export function apply(ctx: Context, config: { evidence: string; automatic?: boolean }): void {
  ctx.on('session/event', (session, event) => {
    appendFileSync(join(config.evidence, 'events.jsonl'), JSON.stringify({ sessionId: session.id, event }) + '\n');
    // The optional compaction package augments the native event union in its own
    // installation; this root fixture observes its documented JSON envelope.
    const observed = event as unknown as { type: string; data: Record<string, unknown> };
    if (config.automatic && session.id.startsWith('worker-') && observed.type === 'compaction/end' && !observed.data.error) {
      void ctx.sessionController.inspect(session.id).then(inspection => {
        writeFileSync(join(config.evidence, 'compacted.json'), JSON.stringify({ result: observed.data, inspection }));
      });
    }
    if (config.automatic && session.id.startsWith('worker-') && event.type === 'turn/end') {
      const agent = ctx.agents.get(session.id);
      const presets = ctx.get('agentPresets') as { serviceFor(agent: unknown, name: string): unknown };
      const backend = agent && presets.serviceFor(agent, 'compaction') as any;
      if (backend) {
        const value = { config: backend.config, measurement: backend.ctx.get('tokenMeter').measure(session) };
        writeFileSync(join(config.evidence, 'measurement.json'), JSON.stringify(value));
        appendFileSync(join(config.evidence, 'measurements.jsonl'), JSON.stringify(value) + '\n');
      }
    }
  }, { global: true });
  const receive = async (message: any) => {
    if (message === 'native-e2e-graceful-stop') { process.emit('SIGTERM'); return; }
    if (!message || !['compact', 'continue', 'settle'].includes(message.kind)) return;
    try {
      const resolved = await ctx.sessionController.resolveAgent(message.sessionId);
      if ('error' in resolved) throw resolved.error;
      const { agent } = resolved;
      await agent.whenIdle();
      if (message.kind === 'compact') {
        await ctx.sessionPersistence.flush();
        const presets = ctx.get('agentPresets') as { serviceFor(agent: unknown, name: string): unknown };
        const backend = presets.serviceFor(agent, 'compaction') as { compactNow(agent: unknown, signal: AbortSignal): Promise<unknown> } | undefined;
        if (!backend) throw new Error('NATIVE_COMPACTION_SERVICE_MISSING');
        const result = await backend.compactNow(agent, AbortSignal.timeout(15000));
        await ctx.sessionPersistence.flush();
        const inspection = await ctx.sessionController.inspect(agent.id);
        writeFileSync(join(config.evidence, 'compacted.json'), JSON.stringify({ result, inspection }));
      } else {
        if (message.kind === 'continue') await ctx.sessionController.prompt({ sessionId: agent.id, requestId: 'verify-persisted-compaction' as SessionRequestId, mode: 'queue',
          content: [{ type: 'text', text: 'VERIFY_PERSISTED_COMPACTION：只核对已保存的摘要，不再创建业务任务，不调用工具。' }] }, AbortSignal.timeout(15000));
        await agent.whenIdle();
        // A completed worker turn can queue one native status relay to the router.
        // Drain both real owners before observing accounting or shutting down.
        const runtime = ctx.get('orchestrator') as { idle(): Promise<void> };
        for (let pass = 0; pass < 2; pass++) {
          await runtime.idle();
          await Promise.all(ctx.agents.list().map(value => value.whenIdle()));
        }
        await ctx.sessionPersistence.flush();
        writeFileSync(join(config.evidence, message.kind === 'continue' ? 'continued.json' : 'settled.json'), JSON.stringify(await ctx.sessionController.inspect(agent.id)));
      }
    } catch (error) { writeFileSync(join(config.evidence, 'probe-error.json'), JSON.stringify({ message: String(error), stack: error instanceof Error ? error.stack : undefined })); }
  };
  process.on('message', receive);
  ctx.effect(() => () => { process.off('message', receive); });
}
