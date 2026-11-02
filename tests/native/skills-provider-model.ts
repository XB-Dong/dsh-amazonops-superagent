/** Offline Anthropic fixture: choose a skill from the actual native catalog and load it with the real schema. */
import { createServer, type ServerResponse } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

function send(res:ServerResponse,index:number,tool?:{name:string;input:unknown}) {
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const emit=(event:string,value:unknown)=>res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  emit('message_start',{type:'message_start',message:{id:`skills-fixture-${index}`,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}});
  emit('content_block_start',{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:`skills-tool-${index}`,name:tool.name,input:{}}:{type:'text',text:''}});
  emit('content_block_delta',{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}:{type:'text_delta',text:'本轮核验结束。'}});
  emit('content_block_stop',{type:'content_block_stop',index:0});
  emit('message_delta',{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});
  emit('message_stop',{type:'message_stop'});res.end();
}
export async function skillModel(evidence:string) {
  const requests:any[]=[];
  const control={holdAfterDraft:true,newWorker:false,held:0,aborted:0};
  const server=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);
      const blocks=body.messages.flatMap((message:any)=>Array.isArray(message.content)?message.content:[{type:'text',text:message.content}]);
      const text=blocks.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join('\n');
      const worker=body.tools?.some((tool:any)=>tool.name==='cc_prepare_task');
      const result=(name:string)=>{
        const ids=blocks.filter((block:any)=>block.type==='tool_use'&&block.name===name).map((block:any)=>block.id);
        return blocks.findLast((block:any)=>block.type==='tool_result'&&ids.includes(block.tool_use_id));
      };
      let tool:{name:string;input:unknown}|undefined;
      let hold=false;
      if(worker&&!control.newWorker){
        if(!result('skill')){
          const name=/`(cc-workflow-[a-f0-9]+)`/.exec(text)?.[1];
          const schema=body.tools.find((tool:any)=>tool.name==='skill')?.input_schema;
          if(!schema?.properties?.name||!schema.required?.includes('name'))throw new Error('ACTUAL_SKILL_SCHEMA_UNAVAILABLE');
          if(!name)throw new Error('ACTUAL_SKILL_CATALOG_UNAVAILABLE');
          tool={name:'skill',input:{name}};
        }else if(!result('cc_prepare_task')){
          const loaded=JSON.stringify(result('skill').content);
          const steps=[...loaded.matchAll(/(?:^|\\n)(\d+)\. ([^\\]+?)(?=\\n|$)/g)].map(match=>match[2]);
          if(!steps.length)throw new Error('ACTUAL_PROVIDER_BODY_UNAVAILABLE');
          tool={name:'cc_prepare_task',input:{title:'已确认经验复用的待确认草稿',timeZone:'Asia/Shanghai',checklist:steps}};
        }else hold=control.holdAfterDraft;
      }else if(!worker){
        const candidate=text.split('\n').filter((line:string)=>line.includes('"next_action":"Route it with orchestrator_route')).at(-1);
        const id=candidate&&/"trigger_id":"([^"]+)"/.exec(candidate)?.[1];
        const routed=blocks.some((block:any)=>block.type==='tool_use'&&block.name==='orchestrator_route'&&block.input.decisions.some((row:any)=>row.trigger_id===id));
        if(id&&!routed)tool={name:'orchestrator_route',input:{decisions:[{kind:'accept',trigger_id:id,title:'复用当前有效库存经验',worktree_name:'approved-stock-skill',acknowledgement:'将按当前有效经验保存待确认草稿。'}]}};
      }
      const record={role:worker?'worker':'router',tool:tool?.name,input:tool?.input,body,hold};
      requests.push(record);appendFileSync(join(evidence,'skill-model.jsonl'),JSON.stringify(record)+'\n');
      if(hold){
        control.held++;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting for synthetic revocation\n\n');
        res.once('close',()=>{control.held--;control.aborted++;});return;
      }
      send(res,requests.length,tool);
    }catch(error){appendFileSync(join(evidence,'fixture-errors.txt'),String(error)+'\n');res.writeHead(500);res.end('{"error":"SKILL_FIXTURE_CONTRACT_FAILED"}');}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  return {server,requests,control,url:`http://127.0.0.1:${(server.address() as {port:number}).port}`};
}
