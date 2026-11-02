/** Test-only stale-agent stimulus; production APIs are never extended by this fixture. */
import type { Context } from '@deepseek-ai/cordis';
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { apply as observe } from '../integration/native-e2e-probe.ts';
export const inject=['sessionPersistence','webServer','agents'];
export function apply(ctx:Context,config:{evidence:string}):void {
  observe(ctx,config);
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/skills-fixture/stale',handler:async(req,res)=>{
    const id=new URL(req.url??'/','http://localhost').searchParams.get('sessionId');
    const agent=id&&ctx.agents.get(id as SessionId);
    let denied=true,exists=!!agent;
    if(agent){
      const result=await agent.ctx.tools.execute({callId:'stale-business-write' as never,name:'cc_prepare_task',
        arguments:{title:'禁止保存的撤销后草稿',timeZone:'Asia/Shanghai',checklist:['不得执行']},agent,signal:new AbortController().signal});
      denied=result.isError;
      agent.followup(freezeMessage({id:MessageId('revoked-worker-followup'),role:'user',source:{kind:'dsh-superagent',form:'relay'},
        content:[{type:'text',text:'撤销后不得继续模型或写入。'}]}));
    }
    res.setHeader('content-type','application/json');res.end(JSON.stringify({exists,denied}));
  }}));
}
