/** Test-only profile setting through the real native settings owner. */
import type { Context } from '@deepseek-ai/cordis';
import type { Runtime } from '../../vendor/superagent/src/extension.ts';
import { apply as observe } from './native-e2e-probe.ts';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { freezeMessage,MessageId } from '@deepseek-ai/dsh-llm';
import { rename } from 'node:fs/promises';
export const inject=['sessionPersistence','webServer','agents'];
export function apply(ctx:Context,config:{evidence:string}):void {
  observe(ctx,config);
  ctx.inject(['orchestrator'],async child=>{
    const runtime=child.get('orchestrator') as unknown as Runtime;await runtime.ready;
    const executor=runtime.settings.block('executor');
    await runtime.settings.save('executor',{...(executor.value as object),maxWorkers:1},executor.revision,'panel');
  });
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/native-e2e/cwd',handler:async(req,res)=>{
    try{
      const query=new URL(req.url??'/','http://localhost').searchParams;
      const agent=ctx.agents.get(query.get('sessionId') as SessionId);if(!agent)throw new Error('AGENT_NOT_LOADED');
      const working=ctx.get('workingDirectory') as {get(session:Agent['session']):string;ensure(agent:Agent):Promise<string>};
      let denied:boolean|undefined,toolReason:string|undefined;
      if(query.has('fallback')){
        // Remove only this synthetic recovered workspace, forcing DSH's documented
        // fallback to the immutable original header. Operations must then refuse it.
        const current=working.get(agent.session);
        await rename(current,`${current}.fixture-unavailable`);
        await working.ensure(agent);
        const result=await agent.ctx.tools.execute({callId:'fallback-write-refused' as never,name:'cc_prepare_task',arguments:{title:'禁止旧目录写入',timeZone:'Asia/Shanghai',checklist:['不得写入']},agent,signal:new AbortController().signal});
        denied=result.isError;
        toolReason=JSON.stringify(result.content);
        agent.followup(freezeMessage({id:MessageId('fallback-model-refused'),role:'user',source:{kind:'dsh-superagent',form:'relay'},content:[{type:'text',text:'旧目录回落后不得继续执行。'}]}));
      }
      res.setHeader('content-type','application/json');res.end(JSON.stringify({headerCwd:agent.session.header.cwd,effectiveCwd:working.get(agent.session),denied,toolReason}));
    }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"CWD_FIXTURE_FAILED"}');}
  }}));
}
