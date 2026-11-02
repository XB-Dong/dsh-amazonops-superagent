import type { WorkSnapshot } from '../packages/contracts/model.ts';
type NativeEvent={sessionId:string;event:{type:string;seq:number;data:any}};
type Delivery={id:string;kind:string;ticketId?:string;text:string;status:string};
/** A ready report or acknowledgement alone never proves final delivery. */
export function liveDeliveryProof(work:WorkSnapshot,events:NativeEvent[],outbox:Delivery[],threadId:string,sourceId:string){
  const user=work.messages.find(message=>message.id===sourceId&&message.threadId===threadId&&message.role==='user');
  const ticket=work.tickets.find(ticket=>ticket.id===user?.ticketId&&ticket.latestReport?.status==='ready');
  if(!ticket)return;
  for(const call of events.filter(row=>row.event.type==='tool/call'&&row.event.data.name==='orchestrator_reply').reverse()){
    let args;try{args=JSON.parse(call.event.data.arguments);}catch{continue;}
    if(args.purpose!=='result'||(args.ticket_id!==ticket.id&&args.trigger_id!==sourceId))continue;
    const delivery=outbox.find(row=>row.kind==='reply'&&row.ticketId===ticket.id&&row.text===args.text&&row.status==='sent');
    if(!delivery||!work.messages.some(message=>message.id===delivery.id&&message.threadId===threadId&&message.text===delivery.text&&message.role==='assistant'))continue;
    const callback=events.find(row=>row.sessionId===call.sessionId&&row.event.type==='tool/result'&&
      row.event.data.message?.toolCallId===call.event.data.callId&&row.event.data.message?.isError!==true);
    if(!callback)continue;
    let value;try{value=JSON.parse(callback.event.data.message.content.find((block:any)=>block.type==='text').text);}catch{continue;}
    if(value.status!=='sent')continue;
    const workerEnd=events.findLast(row=>row.sessionId===`worker-${ticket.id}`&&row.event.type==='turn/end');
    const masterEnd=events.findLast(row=>row.sessionId===call.sessionId&&row.event.type==='turn/end'&&row.event.seq>callback.event.seq);
    if(workerEnd?.event.data.reason?.kind!=='completed'||masterEnd?.event.data.reason?.kind!=='completed')continue;
    return {ticketId:ticket.id,finalReply:delivery,nativeTurnEnd:workerEnd,masterTurnEnd:masterEnd,deliveryCallback:callback};
  }
}
