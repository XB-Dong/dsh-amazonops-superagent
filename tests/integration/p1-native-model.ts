import { createServer,type ServerResponse } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

type Call={name:string;input:Record<string,unknown>};
function response(res:ServerResponse,index:number,tool?:Call){
  const emit=(event:string,data:unknown)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200,{'content-type':'text/event-stream'});
  emit('message_start',{type:'message_start',message:{id:`p1-${index}`,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}});
  emit('content_block_start',{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:`call-${index}`,name:tool.name,input:{}}:{type:'text',text:''}});
  emit('content_block_delta',{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}:{type:'text_delta',text:'本轮已结束。'}});
  emit('content_block_stop',{type:'content_block_stop',index:0});
  emit('message_delta',{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn'},usage:{output_tokens:20}});
  emit('message_stop',{type:'message_stop'});res.end();
}
export async function p1Model(evidence:string){
  const requests:{role:string;tool?:string;input?:Record<string,unknown>}[]=[];
  const server=createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),blocks=(body.messages??[]).flatMap((m:any)=>Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]);
    const text=blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
    const calls=blocks.filter((b:any)=>b.type==='tool_use');
    const results=(name:string)=>{
      const ids=new Set(calls.filter((b:any)=>b.name===name).map((b:any)=>b.id));
      return blocks.filter((b:any)=>b.type==='tool_result'&&ids.has(b.tool_use_id));
    };
    const parseResult=(block:any)=>{const content=block?.content;try{return JSON.parse(typeof content==='string'?content:content?.find((x:any)=>x.type==='text')?.text);}catch{return undefined;}};
    const worker=body.tools?.some((t:any)=>t.name==='cc_prepare_task');let tool:Call|undefined;
    if(worker){
      const watched=JSON.stringify(body.system).includes('当前是用户明确授权的库存持续跟进');
      const completion=text.includes('现在完成跟进');
      const answers=text.includes('选择合成方案A，保存内部草稿');
      const changed=text.includes('已授权库存跟进的新业务变化');
      const lastReport= calls.filter((b:any)=>b.name==='orchestrator_report').at(-1);
      const lastText=blocks.filter((b:any)=>b.type==='text').at(-1)?.text??'';
      const humanIds=[...text.matchAll(/human-work-action-[A-Za-z0-9_-]+/g)].map((m:any)=>m[0]);
      const human=humanIds.at(-1)??/human-watch-[A-Za-z0-9_-]+/.exec(text)?.[0];
      const lastRead=blocks.findLastIndex((b:any)=>b.type==='tool_use'&&b.name==='cc_read_watch');
      const lastReportIndex=blocks.findLastIndex((b:any)=>b.type==='tool_use'&&b.name==='orchestrator_report');
      if(!results('cc_read_watch').length||(watched&&answers&&!results('cc_prepare_task').length&&lastRead<lastReportIndex))tool={name:'cc_read_watch',input:{}};
      else if(!watched){
        if(!results('cc_prepare_task').length)tool={name:'cc_prepare_task',input:{title:'规则内部复核草稿',timeZone:'Asia/Shanghai',checklist:['核对合成缺货风险','等待cc确认']}};
        else if(!lastReport)tool={name:'orchestrator_report',input:{state:'ready',summary:'规则草稿已准备，等待确认。'}};
      }else if(completion){
        if(lastReport?.input.state!=='ready')tool={name:'orchestrator_report',input:{state:'ready',summary:'库存跟进已按cc要求完成，内部草稿等待确认。'}};
      }else if(answers){
        if(!results('cc_prepare_task').length)tool={name:'cc_prepare_task',input:{title:'跟进库存复核草稿',timeZone:'Asia/Shanghai',checklist:['核对合成方案A','等待cc确认']}};
        else if(lastReport?.input.reply_to_trigger_id!==human)tool={name:'orchestrator_report',input:{state:'waiting',summary:'已保存合成方案A复核草稿，继续跟进。',reply_to_trigger_id:human,human_action:null}};
      }else if(changed){
        if(!lastReport?.input.human_action)tool={name:'orchestrator_report',input:{state:'waiting',summary:'检测到库存风险变化，需要cc选择。',human_action:'选择合成方案A还是B？'}};
      }else if(!lastReport)tool={name:'orchestrator_report',input:{state:'waiting',summary:'已开始有限期库存跟进。',reply_to_trigger_id:human}};
    }else{
      const lines=text.split('\n');
      const report=lines.filter((l:string)=>/"kind":"worker_(?:attention|report)"/.test(l)).at(-1);
      if(report){
        try{const r=JSON.parse(report.slice(report.indexOf('{')));const ticketId=r.ticket.ticket_id;
          const attention=r.kind==='worker_attention',answer=r.answer_to;
          const purpose=attention?'attention':answer?'answer':r.state==='ready'?'result':undefined;
          const match=purpose&&calls.some((b:any)=>b.name==='orchestrator_reply'&&b.input.ticket_id===ticketId&&b.input.purpose===purpose&&(!answer||b.input.trigger_id===answer));
          if(purpose&&!match)tool={name:'orchestrator_reply',input:{ticket_id:ticketId,purpose,text:attention?'请选择合成方案A或B。':r.summary??'已交付。',...(answer?{trigger_id:answer}:{}),...(attention?{human_action:r.ticket.attention?.question}: {})}};
        }catch{}
      }
      if(!tool){
        const candidate=lines.filter((l:string)=>l.includes('"trigger_id"')&&l.includes('"next_action"')).at(-1);
        const trigger=candidate&&/"trigger_id"\s*:\s*"([^"\n]+)"/.exec(candidate)?.[1];
        const inferred=candidate?.includes('assess it with orchestrator_eval');
        if(trigger&&inferred){
          const evalCall=calls.findLast((b:any)=>b.name==='orchestrator_eval'&&b.input.trigger_id===trigger);
          const evalResult=evalCall&&blocks.find((b:any)=>b.type==='tool_result'&&b.tool_use_id===evalCall.id);
          const decided=calls.some((b:any)=>b.name==='orchestrator_eval_decide'&&b.input.trigger_id===trigger);
          if(!evalCall)tool={name:'orchestrator_eval',input:{trigger_id:trigger}};
          else if(evalResult&&!decided)tool={name:'orchestrator_eval_decide',input:{trigger_id:trigger,decision:'accept',title:'缺货风险内部复核',worktree_name:'stock-risk-review',scope:'仅创建内部复核草稿',reason:'唯一规则匹配当前确定性缺货风险',intent_evidence:'已配置库存缺货内部复核规则',direction:{implementation_requested:true,target_basis:'specified',requires_design_decision:false,evidence:'对象与内部草稿输出已由规则明确'},rule_assessments:[{rule_id:'inventory-risk-review',matched:true,reason:'当前方案存在明确缺货风险'}]}};
        }else if(trigger&&!calls.some((b:any)=>b.name==='orchestrator_route'&&b.input.decisions?.some((d:any)=>d.trigger_id===trigger)))
          tool={name:'orchestrator_route',input:{decisions:[{kind:'accept',trigger_id:trigger,title:'库存持续跟进',worktree_name:'stock-watch',acknowledgement:'将按明确期限持续跟进库存方案。'}]}};
      }
    }
    const record={role:worker?'worker':'router',tool:tool?.name,input:tool?.input};requests.push(record);
    appendFileSync(join(evidence,'model-requests.jsonl'),JSON.stringify({...record,body})+'\n');response(res,requests.length,tool);
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  return {server,requests,url:`http://127.0.0.1:${(server.address() as {port:number}).port}`};
}
