/** Test-only profile setting through the real native settings owner. */
import type { Context } from '@deepseek-ai/cordis';
import type { Runtime } from '../../vendor/superagent/src/extension.ts';
import { apply as observe } from './native-e2e-probe.ts';
export const inject=['sessionPersistence','webServer'];
export function apply(ctx:Context,config:{evidence:string}):void {
  observe(ctx,config);
  ctx.inject(['orchestrator'],async child=>{
    const runtime=child.get('orchestrator') as unknown as Runtime;await runtime.ready;
    const executor=runtime.settings.block('executor');
    await runtime.settings.save('executor',{...(executor.value as object),maxWorkers:1},executor.revision,'panel');
  });
}
