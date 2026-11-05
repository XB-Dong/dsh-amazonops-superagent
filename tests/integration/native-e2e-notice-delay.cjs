/** Synthetic scheduling only: delay a real loopback request, never alter its body or the native inbox. */
const fs=require('node:fs');
const gate=process.env.AMAZONOPS_E2E_NOTICE_RELEASE;
if(gate){
  const originalFetch=globalThis.fetch;let delayed=false;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    let body;try{body=JSON.parse(options?.body);}catch{}
    const blocks=(body?.messages??[]).flatMap(message=>Array.isArray(message.content)?message.content:[]);
    const notice=blocks.findLast(block=>block.type==='text'&&block.text?.startsWith('{"ticket_ended":'));
    const reply=blocks.some(block=>block.type==='tool_use'&&block.name==='orchestrator_reply');
    if(!delayed&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&notice&&reply&&!fs.existsSync(gate)){
      delayed=true;
      fs.writeFileSync(`${gate}.waiting`,JSON.stringify({at:Date.now(),url:url.href,notice:notice.text}));
      const deadline=Date.now()+12000;
      while(!fs.existsSync(gate)){
        if(Date.now()>deadline)throw new Error('E2E_NOTICE_TRANSPORT_NOT_RELEASED');
        await new Promise(done=>setTimeout(done,5));
      }
    }
    return originalFetch(input,options);
  };
}
