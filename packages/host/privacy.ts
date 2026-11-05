import { createHash } from 'node:crypto';
import { existsSync,readFileSync } from 'node:fs';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Business,Base } from '../business/index.ts';
import type { Runtime,Ticket } from '../../vendor/superagent/src/extension.ts';
import type { AgentTools } from './agent-tools.ts';
import type { WorkbenchSource } from './source.ts';
import { permittedBusinessTrigger, readableBusinessTrigger, followupToolGuard } from './followup-native-authority.ts';

/** Durable privacy decisions also select a fresh native routing context after restore. */
export function privacyEpoch(business:Business):string {
  return createHash('sha256').update(existsSync(business.store.ledgerPath)?readFileSync(business.store.ledgerPath):'').digest('hex');
}
export function privacyHooks(business:Business,runtime:()=>Runtime|undefined,source:()=>WorkbenchSource|undefined,tools:AgentTools){
  const permittedTrigger=(scope:string,id:string)=>{
    const trigger=runtime()?.store.triggers.get(id);
    if(!trigger||trigger.meta.scope!==scope||!permittedBusinessTrigger(business,trigger))throw new Error('SOURCE_FORBIDDEN');
    return trigger;
  };
  const readableTrigger=(scope:string,id:string)=>{
    const trigger=runtime()?.store.triggers.get(id);
    if(!trigger||trigger.meta.scope!==scope||!readableBusinessTrigger(business,trigger))throw new Error('SOURCE_FORBIDDEN');
    return trigger;
  };
  const allowedText=(text:string):boolean=>{
    const deleted=business.store.db.prepare('SELECT id FROM tombstones WHERE scope=?').all('main');
    if(deleted.some(row=>text.includes(String(row.id))))return false;
    const current=runtime(),work=source();
    if(current&&work&&current.store.tickets.list().some(ticket=>text.includes(ticket.id)&&!work.allowedTicket('main',ticket.id)))return false;
    return true;
  };
  return {
    epoch:()=>privacyEpoch(business),
    allowMasterInput:(input:{kind:'candidate'|'relay'|'notice';id:string;text:string})=>allowedText(input.text),
    authorizeAgent:(agent:Agent,ticket?:Ticket)=>{if(ticket)tools.authorize(agent,ticket);},
    authorizeTool:(agent:Agent,ticket:Ticket|undefined,name:string,args:unknown)=>{
      const input=args as Record<string,unknown>;
      if(!allowedText(JSON.stringify(input)))throw new Error('DERIVATION_REVOKED');
      if(!ticket){
        if(name==='orchestrator_route'){
          for(const decision of (input.decisions??[]) as Record<string,unknown>[]){
            permittedTrigger('main',String(decision.trigger_id));
            if(decision.ticket_id&&!source()?.allowedTicket('main',String(decision.ticket_id)))throw new Error('SOURCE_FORBIDDEN');
          }
        }else if(name==='orchestrator_reply'){
          if(input.trigger_id)permittedTrigger('main',String(input.trigger_id));
          if(input.ticket_id&&!source()?.allowedTicket('main',String(input.ticket_id)))throw new Error('SOURCE_FORBIDDEN');
        }else if(name==='orchestrator_eval'||name==='orchestrator_eval_decide'){
          if(typeof input.trigger_id!=='string'||!input.trigger_id.trim())
            throw new Error('MISSING_TRIGGER_ID: supply the same trigger_id used for orchestrator_eval; authority cannot be inferred');
          const trigger=permittedTrigger('main',String(input.trigger_id));
          if(trigger.human||trigger.meta.eventClass!=='risk_candidate')throw new Error('SOURCE_FORBIDDEN');
        }else throw new Error('TOOL_FORBIDDEN');
        return;
      }
      tools.authorize(agent,ticket);
      const current=runtime()!.store.tickets.get(ticket.id)!;
      followupToolGuard(business,runtime()!,current,name,input);
      const ids=new Set([...current.origin.triggerIds,...current.inputs.flatMap(row=>row.kind==='trigger'?[row.triggerId]:[])]);
      if(input.trigger_id&&!ids.has(String(input.trigger_id)))throw new Error('SOURCE_FORBIDDEN');
      if(name==='orchestrator_read'){
        const resource=String(input.resource);
        if(resource===`ticket/${ticket.id}`||resource.startsWith(`ticket/${ticket.id}/`))return;
        const readId=resource.startsWith('trigger/')?resource.slice(8):undefined;
        if(!readId||!ids.has(readId))throw new Error('SOURCE_FORBIDDEN');
        const trigger=readableTrigger('main',readId);
        const consumed=new Set<string>();
        for(const thread of trigger.threads){
          const rows=runtime()!.store.read.threadTriggers(`${thread.source}:${thread.id}`,2147483647);
          for(const row of rows){readableTrigger('main',row.id);consumed.add(row.id);}
        }
        const binding=business.store.get<Base&{sources:string[]}>('main',`native-binding:${agent.id}`);
        const sources=[...new Set([...binding.sources,...consumed])];
        if(sources.length!==binding.sources.length)business.store.update(binding,{sources});
      }
    },
  };
}
