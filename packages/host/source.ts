import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, type Business, type Base } from '../business/index.ts';
import type { Runtime, SourceKind, Trigger } from '../../vendor/superagent/src/extension.ts';
import type { WorkSnapshot, WorkAction } from '../contracts/model.ts';
import { actOnWork, projectResponsibility } from './work-actions.ts';
import { admitEvent } from './operations.ts';
import { safeText } from '../business/core/validation.ts';

type MessageReceipt={hash:string;threadId:string;sourceId:string};
type OutboxMessage={id:string;channel:{source:string;thread:string;address:Record<string,string>};text:string;ticketId?:string;status:string};
export class WorkbenchSource {
  runtime:Runtime; business:Business;
  constructor(runtime:Runtime,business:Business){this.runtime=runtime;this.business=business;}
  async initializePolicy():Promise<void> {
    const policy=this.runtime.store.settings().policy;
    if(policy.sources.amazonops)return;
    await this.runtime.settings.save('policy',{...policy,sources:{...policy.sources,amazonops:{allowed:[{id:'cc',name:'cc'}]}}},
      this.runtime.store.blockRevision('policy'),'sync');
  }
  register():()=>void {
    const kind:SourceKind = {kind:'amazonops',title:{zh:'cc运营工作台',en:'Operations workbench'},
      description:{zh:'认证的本机运营请求',en:'Authenticated local requests'},schema:z.object({}),fields:[],health:[],
      scope:({meta})=>meta.eventClass==='human_request' && meta.scope==='main'
        ?{listened:true,observed:false}:{listened:false,reason:'untrusted_event'},
      policy:{schema:z.object({allowed:z.array(z.object({id:z.string(),name:z.string().optional()})).default([{id:'cc',name:'cc'}])}),
        fields:[],explicit:{zh:'工作台明确提交',en:'Explicit workbench request'}},
      channel:{
        allowed:address=>address.scope==='main',
        send:async(_host,message)=>{
          if (message.channel.address.scope!=='main') return 'gone';
          if (message.ticketId && !this.allowedTicket('main',message.ticketId)) return 'gone';
          this.business.store.once('main',`native-delivery:${message.id}`,()=>({at:new Date().toISOString()}));
          return 'sent';
        },
        link:()=>({url:'',label:{zh:'运营助手',en:'Assistant'}}),
      },
      threadContext:{messageId:trigger=>trigger.id,
        read:async(_commands,trigger,_part,cursor)=>{
          const scope=String(trigger.meta.scope);
          const offset=cursor?Number(cursor):0;
          if (!Number.isSafeInteger(offset)||offset<0) throw new Error('INVALID_OFFSET');
          const all=this.runtime.store.read.threadTriggers(`amazonops:${trigger.threads[0]!.id}`,200)
            .filter(row=>row.meta.scope===scope&&!this.business.store.isDeleted(scope,row.id));
          const messages=all.slice(offset,offset+20).map(row=>({id:row.id,from:'cc',at:row.at,text:row.text}));
          return {messages,body:{messages},...(offset+20<all.length?{next:String(offset+20)}:{})};
        }},
    };
    return this.runtime.sources.register(kind);
  }
  async submit(scope:string,text:string,requestId:string,threadId?:string) {
    if(!admitEvent({eventClass:'human_request',actorKind:'human',authenticated:true,scope})) throw new Error('SCOPE_FORBIDDEN');
    text=safeText(text,2000);
    if(!/^[\w-]{1,100}$/.test(requestId))throw new Error('INVALID_TEXT');
    if(threadId && !this.runtime.store.read.threadTriggers(`amazonops:${threadId}`,1).some(row=>row.meta.scope===scope))throw new Error('NOT_FOUND');
    const hash=digest({text,threadId:threadId??null});
    const receipt=this.business.store.once<MessageReceipt>(scope,`human-message:${requestId}`,()=>{
      const source=this.business.capture.enqueue(scope,text,`human-${requestId}`);
      return {hash,threadId:threadId??randomUUID(),sourceId:source.id};
    });
    if(receipt.hash!==hash)throw new Error('REQUEST_CONFLICT');
    this.business.store.get(scope,receipt.sourceId);
    const trigger:Trigger={id:receipt.sourceId,source:'amazonops',threads:[{source:'amazonops',id:receipt.threadId}],
      actor:{source:'amazonops',id:'cc'},human:true,addressed:'direct',at:new Date().toISOString(),text,
      channel:{source:'amazonops',thread:receipt.threadId,address:{scope,threadId:receipt.threadId}},
      meta:{scope,eventClass:'human_request',messageId:receipt.sourceId}};
    const existing=this.runtime.store.triggers.get(trigger.id);
    await this.runtime.context({kind:'amazonops',health:[]}).receive(existing??trigger);
    return {messageId:receipt.sourceId,threadId:receipt.threadId};
  }
  allowedTicket(scope:string,id:string):boolean {
    const ticket=this.runtime.store.tickets.get(id);
    if(!ticket)return false;
    const trigger=this.runtime.store.triggers.get(ticket.origin.triggerId);
    const binding=this.business.store.list<Base&{skills?:{id:string;hash:string}[]}>(scope,'native-binding').find(row=>row.id===`native-binding:worker-${ticket.id}`);
    const lineage=[...ticket.origin.triggerIds,...ticket.inputs.flatMap(input=>input.kind==='trigger'?[input.triggerId]:[])];
    return trigger?.source==='amazonops' && trigger.meta.scope===scope &&
      !this.business.store.isDeleted(scope,`native-binding:worker-${ticket.id}`) &&
      (binding?.skills??[]).every(skill=>this.business.learning.activeSkills(scope).some(active=>active.id===skill.id&&active.hash===skill.hash)) &&
      !lineage.some(source=>this.business.store.isDeleted(scope,source));
  }
  sessions(scope:string):ReadonlySet<string> {
    return new Set(this.runtime.store.tickets.list().filter(t=>this.allowedTicket(scope,t.id)).map(t=>`worker-${t.id}`));
  }
  work(scope:string,page?:{offset:number;limit:number}):WorkSnapshot {
    if(page&&(!Number.isSafeInteger(page.offset)||page.offset<0||!Number.isSafeInteger(page.limit)||page.limit<1||page.limit>100))throw new Error('INVALID_OFFSET');
    const allTickets=this.runtime.store.tickets.list().filter(ticket=>this.allowedTicket(scope,ticket.id));
    const tickets=page?allTickets.slice(page.offset,page.offset+page.limit):allTickets;
    const triggers=this.runtime.store.read.triggers({source:'amazonops'},0,500).items
      .filter(trigger=>trigger.meta.scope===scope&&!this.business.store.isDeleted(scope,trigger.id));
    const replies=this.runtime.store.db.prepare("SELECT value FROM outbox WHERE json_extract(value,'$.channel.source')=? AND json_extract(value,'$.channel.address.scope')=? ORDER BY rowid DESC LIMIT 200")
      .all('amazonops',scope).map(row=>JSON.parse(String(row.value)) as OutboxMessage)
      .filter(row=>row.status==='sent'&&(!row.ticketId||this.allowedTicket(scope,row.ticketId)));
    return {tickets:tickets.map(ticket=>{
      const report=ticket.assignments.findLast(assignment=>assignment.report)?.report;
      const origin=this.runtime.store.triggers.get(ticket.origin.triggerId)!;
      return {id:ticket.id,title:ticket.title,status:ticket.ended?.outcome??report?.state??'working',sessionId:`worker-${ticket.id}`,
        ...projectResponsibility(ticket,origin.threads[0]!.id),
        ...(report?{latestReport:{text:report.summary,status:report.state}}:{})};
    }),messages:[...triggers.map(trigger=>({id:trigger.id,threadId:trigger.threads[0]!.id,role:'user' as const,text:trigger.text,at:trigger.at,
      ticketId:tickets.find(ticket=>ticket.origin.triggerIds.includes(trigger.id)||ticket.inputs.some(input=>input.kind==='trigger'&&input.triggerId===trigger.id))?.id})),
      ...replies.reverse().map(reply=>({id:reply.id,threadId:reply.channel.thread,role:'assistant' as const,text:reply.text,ticketId:reply.ticketId,
        at:this.deliveryTime(scope,reply.id)??allTickets.find(ticket=>ticket.id===reply.ticketId)?.updatedAt??new Date(0).toISOString()}))].sort((a,b)=>a.at.localeCompare(b.at)),
      ...(page?{pagination:{offset:page.offset,total:allTickets.length,nextOffset:page.offset+page.limit<allTickets.length?page.offset+page.limit:null}}:{})};
  }
  action(scope:string,input:WorkAction):Promise<unknown>{return actOnWork(this,scope,input);}
  private deliveryTime(scope:string,id:string):string|undefined {
    const row=this.business.store.db.prepare('SELECT result FROM receipts WHERE scope=? AND request_key=?').get(scope,`native-delivery:${id}`);
    return row?(JSON.parse(String(row.result)) as {at?:string}).at:undefined;
  }
  cancel(scope:string,id:string):void {
    if(!this.allowedTicket(scope,id))throw new Error('NOT_FOUND');
    const current=this.runtime.store.tickets.get(id)!;
    if(!current.ended)this.runtime.engine.stopTicket(id,'cc explicitly cancelled');
  }
  revokeDeleted():void {
    for(const ticket of this.runtime.store.tickets.open()){
      const origin=this.runtime.store.triggers.get(ticket.origin.triggerId);
      if(origin?.source==='amazonops'&&typeof origin.meta.scope==='string'&&!this.allowedTicket(origin.meta.scope,ticket.id))
        this.runtime.engine.stopTicket(ticket.id,'source revoked');
    }
  }
}
