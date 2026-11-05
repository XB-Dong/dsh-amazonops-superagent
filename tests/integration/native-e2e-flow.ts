/** Validate actual persisted DSH input/step provenance, rather than a wall-clock global counter. */
import assert from 'node:assert/strict';
import type { NativeRequestContext } from './native-e2e-model.ts';
export type NativeEvent={sessionId:string;event:{type:string;seq:number;data:any}};
type Request={role:string;tool?:string;nativeContext?:NativeRequestContext};
const payload=(message:any)=>{try{return JSON.parse(message.content.find((block:any)=>block.type==='text').text);}catch{return undefined;}};

export function assertNativeInitialFlow(events:NativeEvent[],requests:Request[],ids:{master:string;ticket:string;trigger:string}){
  const worker=`worker-${ids.ticket}`,sessions=[ids.master,worker];
  const relevant=events.filter(row=>sessions.includes(row.sessionId));
  const steps=relevant.filter(row=>row.event.type==='step/start');
  const allowed=(message:any,session:string)=>{
    if(message.source?.kind!=='dsh-superagent')return false;
    const value=payload(message);
    if(session===worker)return message.source.form==='relay'&&value?.ticket_id===ids.ticket&&value?.trigger?.trigger_id===ids.trigger;
    if(message.source.form==='relay')return (value?.kind==='candidate'&&value.trigger_id===ids.trigger)||
      (value?.kind==='worker_report'&&value.ticket?.ticket_id===ids.ticket&&value.state==='ready');
    return message.source.form==='notice'&&message.id?.startsWith('dsh-superagent:notice:')&&
      value?.ticket_ended?.ticket_id===ids.ticket&&value.ticket_ended.state==='completed';
  };
  const freshInputs=(step:NativeEvent)=>{
    const history=relevant.filter(row=>row.sessionId===step.sessionId);
    const boundary=history.find(row=>row.event.seq>step.event.seq&&['step/end','turn/end'].includes(row.event.type));
    assert.ok(boundary,'every observed model step must settle');
    return history.filter(row=>row.event.type==='user/message'&&row.event.seq>step.event.seq&&row.event.seq<boundary.event.seq)
      .filter(row=>allowed(row.event.data,step.sessionId)).map(row=>{
        const message=row.event.data;
        assert.equal(history.some(prior=>prior.event.type==='user/message'&&prior.event.seq<row.event.seq&&prior.event.data.id===message.id),false,
          'a consumed input cannot authorize another native step');
        const insertion=history.find(prior=>prior.event.type==='agent/inbox/spliced'&&prior.event.seq<step.event.seq&&
          prior.event.data.inserted?.some((item:any)=>item.id===message.id));
        assert.ok(insertion,'new native input must originate in the actual durable inbox');
        assert.deepEqual(insertion.event.data.inserted.find((item:any)=>item.id===message.id),message,'consumed native input must match its queued payload');
        return message;
      });
  };
  for(const request of requests){
    const context=request.nativeContext;assert.ok(context,'provider request must identify an actual native step');
    assert.equal(context.sessionId,request.role==='worker'?worker:ids.master);
    const step=steps.find(row=>row.sessionId===context.sessionId&&row.event.seq===context.stepSeq);
    assert.ok(step,'provider request cannot invent a turn or step');
    assert.deepEqual([context.turn,context.step],[step.event.data.turn,step.event.data.step]);
  }
  for(const step of steps){
    assert.equal(requests.filter(request=>request.nativeContext?.sessionId===step.sessionId&&request.nativeContext.stepSeq===step.event.seq).length,1,
      'each actual native step has exactly one provider request, without retries or duplicate calls');
  }
  for(const start of relevant.filter(row=>row.event.type==='turn/start')){
    const first=steps.find(row=>row.sessionId===start.sessionId&&row.event.data.turn===start.event.data.turn);
    assert.ok(first);assert.ok(freshInputs(first).length>0,'a new native turn requires fresh admitted inbox input');
    assert.ok(relevant.some(row=>row.sessionId===start.sessionId&&row.event.type==='turn/end'&&row.event.data.turn===start.event.data.turn&&row.event.data.reason.kind==='completed'));
  }
  const continuations:{sessionId:string;turn:number;step:number;inputIds:string[]}[]=[];
  const calls=relevant.filter(row=>row.event.type==='tool/call');
  for(const result of relevant.filter(row=>row.event.type==='tool/result'&&row.event.data.message.isError!==true)){
    const call=calls.find(row=>row.sessionId===result.sessionId&&row.event.data.callId===result.event.data.message.toolCallId);
    if(!call||!['orchestrator_route','orchestrator_report','orchestrator_reply'].includes(call.event.data.name))continue;
    for(const next of steps.filter(row=>row.sessionId===result.sessionId&&row.event.seq>result.event.seq&&row.event.data.turn===result.event.data.turn)){
    const admitted=freshInputs(next);
    assert.ok(admitted.length>0,'a terminal tool cannot request another model step without fresh inbox input');
    if(call.event.data.name==='orchestrator_report')assert.fail('the ready worker has no authorized follow-up input in this scenario');
    const provider=requests.find(request=>request.nativeContext?.sessionId===next.sessionId&&request.nativeContext.stepSeq===next.event.seq)!;
    for(const message of admitted)assert.ok(provider.nativeContext!.inputs.some(input=>input.id===message.id),'the actual provider request must consume the new queued input');
    if(call.event.data.name==='orchestrator_reply'){
      assert.ok(admitted.every(message=>payload(message)?.ticket_ended?.ticket_id===ids.ticket),'post-reply continuation is only the actual ticket-ended notice');
      assert.equal(provider.tool,undefined,'the notice does not authorize another business tool callback');
    }
    if(!continuations.some(row=>row.sessionId===next.sessionId&&row.turn===next.event.data.turn&&row.step===next.event.data.step))
      continuations.push({sessionId:next.sessionId,turn:next.event.data.turn,step:next.event.data.step,inputIds:admitted.map(message=>message.id)});
    }
  }
  assert.equal(requests.filter(request=>request.role==='worker').length,2,'the ready worker must perform exactly prepare and report');
  return {steps:steps.length,turns:relevant.filter(row=>row.event.type==='turn/start').length,continuations};
}
