import { Followups, type Business, type Base } from '../business/index.ts';
import type { FollowupEvent, InventoryWatch } from '../contracts/followups.ts';
import type { Runtime, Ticket, Trigger } from '../../vendor/superagent/src/extension.ts';

export const RISK_RULE_ID='inventory-risk-review';
export const RISK_BOT='inventory-risk';
export const RISK_INSTRUCTION='只对明确纳入的库存方案，依据服务端确定性缺货风险创建一份内部复核草稿。相同风险窗口不重复。禁止外部系统、代码、部署和权限变更；无明确风险或对象则忽略。';
export const sameIdentity=(a:{store:string;site:string;listing:string;physicalSku:string},b:typeof a)=>
  a.store===b.store&&a.site===b.site&&a.listing===b.listing&&a.physicalSku===b.physicalSku;

export function currentEvent(business:Business,scope:string,eventId:string):FollowupEvent {
  const service=new Followups(business.store);
  const event=business.store.get<FollowupEvent>(scope,eventId);
  if(event.kind!=='followup-event'||event.eventId!==event.id||business.store.isDeleted(scope,event.id)||
    event.sources.some(id=>business.store.isDeleted(scope,id)))throw new Error('FOLLOWUP_EVENT_STALE');
  const risk=service.risk(scope,event.inventoryId);
  if(risk.digest!==event.risk.digest)throw new Error('FOLLOWUP_EVENT_STALE');
  if(event.watchId){
    const watch=service.get(scope,event.watchId);service.requireActive(watch);
    if(!sameIdentity(watch,risk))throw new Error('FOLLOWUP_EVENT_STALE');
  }else{
    const rule=service.rule(scope);
    if(!rule||rule.mode==='off'||rule.mode!==event.ruleMode||rule.revision!==event.ruleRevision||!risk.stockoutDate||
      !rule.inventoryIds.some(id=>sameIdentity(service.risk(scope,id),risk)))throw new Error('FOLLOWUP_EVENT_STALE');
    if(service.list(scope).some(watch=>watch.status==='active'&&Date.parse(watch.expiresAt)>Date.now()&&sameIdentity(watch,risk)))
      throw new Error('FOLLOWUP_EVENT_STALE');
  }
  return event;
}
export function permittedBusinessTrigger(business:Business,trigger:Trigger):boolean {
  if(trigger.source!=='amazonops'||trigger.meta.scope!=='main'||business.store.isDeleted('main',trigger.id))return false;
  if(trigger.human){
    try{const source=business.store.get<Base&{origin?:string;text?:string}>('main',trigger.id);
      return trigger.meta.eventClass==='human_request'&&trigger.actor.id==='cc'&&source.kind==='source'&&source.origin==='user'&&source.text===trigger.text;
    }catch{return false;}
  }
  try{
    const event=currentEvent(business,'main',String(trigger.meta.eventId));
    return trigger.id===`event-${event.id}`&&trigger.meta.eventClass===event.eventClass&&
      trigger.actor.id===(event.watchId?'inventory-update':RISK_BOT);
  }catch{return false;}
}
export function ticketWatch(business:Business,runtime:Runtime,ticket:Ticket,requireActive=true):InventoryWatch|undefined {
  const origin=runtime.store.triggers.get(ticket.origin.triggerId);
  if(!origin?.meta.watchId)return;
  const service=new Followups(business.store);
  const watch=service.get('main',String(origin.meta.watchId));
  if(watch.sourceId!==origin.id||origin.meta.scope!=='main'||!origin.human)throw new Error('WATCH_AUTHORITY_INVALID');
  if(requireActive)service.requireActive(watch);
  if(watch.ticketId&&watch.ticketId!==ticket.id)throw new Error('WATCH_TICKET_CONFLICT');
  return watch;
}
export function authorizeFollowup(business:Business,runtime:Runtime,ticket:Ticket):void {
  const origin=runtime.store.triggers.get(ticket.origin.triggerId);
  const watch=ticketWatch(business,runtime,ticket);
  if(watch)new Followups(business.store).bindTicket('main',watch.id,ticket.id);
  if(origin?.meta.eventClass==='risk_candidate'&&!permittedBusinessTrigger(business,origin))throw new Error('FOLLOWUP_EVENT_STALE');
}
export function followupToolGuard(business:Business,runtime:Runtime,ticket:Ticket,name:string,args:Record<string,unknown>):void {
  const origin=runtime.store.triggers.get(ticket.origin.triggerId);
  const watch=ticketWatch(business,runtime,ticket);
  if(!watch&&origin?.meta.eventClass!=='risk_candidate')return;
  authorizeFollowup(business,runtime,ticket);
  if(['cc_copy_task','cc_capture_feedback'].includes(name))throw new Error('FOLLOWUP_TOOL_FORBIDDEN');
  if(watch&&name==='orchestrator_report'&&args.state==='ready'){
    const explicitCompletion=ticket.inputs.some(input=>{
      if(input.kind!=='trigger'||!input.human)return false;
      const trigger=runtime.store.triggers.get(input.triggerId);
      return trigger?.human&&trigger.meta.eventClass==='human_request'&&/^(?:请|现在)?(?:完成|结束|停止)跟进(?:[，。！？!,.\s]|$)/.test(trigger.text.trim());
    });
    if(!explicitCompletion)throw new Error('WATCH_REQUIRES_WAITING');
  }
  if(name==='cc_prepare_task'){
    const binding=business.store.list<Base&{sourceId:string;riskDigest?:string}>('main','native-binding').find(row=>row.id===`native-binding:worker-${ticket.id}`);
    const inventoryId=watch?.inventoryId??currentEvent(business,'main',String(origin!.meta.eventId)).inventoryId;
    if(binding?.riskDigest!==new Followups(business.store).risk('main',inventoryId).digest)throw new Error('WATCH_FACTS_NOT_READ');
    const trigger=binding&&runtime.store.triggers.get(binding.sourceId);
    if(trigger&&!trigger.human)currentEvent(business,'main',String(trigger.meta.eventId));
  }
}
