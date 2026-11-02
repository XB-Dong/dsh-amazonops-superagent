import test from 'node:test';
import assert from 'node:assert/strict';
import { liveDeliveryProof } from '../../scripts/live-proof.ts';
import type { WorkSnapshot } from '../../packages/contracts/model.ts';

test('live acceptance refuses acknowledgement plus ready and requires a sent final result with completed native turns',()=>{
  const work:WorkSnapshot={tickets:[{id:'ticket',title:'Synthetic',status:'ready',latestReport:{status:'ready',text:'draft saved'}}],
    messages:[{id:'source',threadId:'thread',role:'user',text:'synthetic',ticketId:'ticket',at:'0'},
      {id:'ack',threadId:'thread',role:'assistant',text:'received',ticketId:'ticket',at:'1'}]};
  const event=(type:string,seq:number,data:unknown,sessionId='master')=>({sessionId,event:{type,seq,data}});
  const workerEnd=event('turn/end',4,{reason:{kind:'completed'}},'worker-ticket');
  assert.equal(liveDeliveryProof(work,[workerEnd],[],'thread','source'),undefined);
  const call=event('tool/call',5,{name:'orchestrator_reply',callId:'call',arguments:JSON.stringify({purpose:'result',ticket_id:'ticket',text:'draft saved'})});
  const callback=event('tool/result',6,{message:{toolCallId:'call',isError:false,content:[{type:'text',text:'{"status":"sent"}'}]}});
  const delivery={id:'final',kind:'reply',ticketId:'ticket',text:'draft saved',status:'sent'};
  work.messages.push({id:'final',threadId:'thread',role:'assistant',text:'draft saved',ticketId:'ticket',at:'2'});
  assert.equal(liveDeliveryProof(work,[workerEnd,call,callback],[delivery],'thread','source'),undefined);
  const events=[workerEnd,call,callback,event('turn/end',7,{reason:{kind:'completed'}})];
  assert.equal(liveDeliveryProof(work,events,[{...delivery,status:'pending'}],'thread','source'),undefined);
  assert.equal(liveDeliveryProof(work,events,[delivery],'thread','source')?.finalReply.id,'final');
});
