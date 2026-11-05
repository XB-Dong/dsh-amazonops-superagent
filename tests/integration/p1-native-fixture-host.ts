/** Test composition uses the actual business owner, Source, tools and native Runtime. */
import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Business,ModelBudget } from '../../packages/business/index.ts';
import { Auth } from '../../packages/host/auth.ts';
import { installBoundary } from '../../packages/host/boundary.ts';
import { AgentTools } from '../../packages/host/agent-tools.ts';
import { WorkbenchSource } from '../../packages/host/source.ts';
import { privacyHooks } from '../../packages/host/privacy.ts';
import { installAccounting } from '../../packages/host/accounting.ts';
import { json,readBody,failure } from '../../packages/host/http.ts';
import type { Runtime,OperationsExtensions } from '../../vendor/superagent/src/extension.ts';

export const inject=['webServer','llm','sessionPersistence'];
export function apply(ctx:Context,config:{dataDir:string;password:string;evidence:string}){
  const business=new Business(config.dataDir),auth=new Auth(config.password);
  const budget=new ModelBudget(join(config.dataDir,'model-budget.sqlite'),{maxCalls:null,maxInputTokens:null,maxOutputTokens:null,maxTotalTokens:null});
  const accounting=installAccounting(ctx,budget,{live:true,maxRequestsPerTurn:12,defaultOutputTokens:2048});
  let runtime:Runtime|undefined,source:WorkbenchSource|undefined;
  const tools=new AgentTools(business,()=>{if(!runtime)throw new Error('NOT_READY');return runtime;});
  ctx.provide('amazonopsHooks',{privacy:privacyHooks(business,()=>runtime,()=>source,tools),
    tools:(agent,ticket)=>tools.tools(agent,ticket),onAgent:(agent,ticket)=>tools.onAgent(agent,ticket)} satisfies OperationsExtensions);
  const origin=ctx.webServer.getOrigin(),server=(ctx.webServer as unknown as {server:Server}).server;
  const boundary=installBoundary(server,origin,auth);
  ctx.inject(['orchestrator'],async child=>{
    const current=child.get('orchestrator') as unknown as Runtime;await current.ready;
    runtime=current;source=new WorkbenchSource(current,business);const off=source.register();await source.initializePolicy();
    child.effect(()=>()=>{off();source=undefined;runtime=undefined;});
  });
  ctx.on('session/event',(session,event)=>appendFileSync(join(config.evidence,'session-events.jsonl'),JSON.stringify({sessionId:session.id,event})+'\n'),{global:true});
  ctx.logger.exporter({export(message){appendFileSync(join(config.evidence,'native-logs.jsonl'),JSON.stringify({name:message.name,type:message.type,args:message.args.map(String)})+'\n');}});
  const shutdown=(message:unknown)=>{if(message==='p1-stop')process.emit('SIGTERM');};process.on('message',shutdown);
  ctx.effect(()=>()=>process.off('message',shutdown));
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/amazonops/api',handler:async(req,res)=>{
    try{
      const path=new URL(req.url??'/',origin).pathname.slice('/amazonops/api/'.length);
      if(path==='login'){
        const body=await readBody(req);const token=auth.login(body.password,req.socket.remoteAddress);
        res.setHeader('set-cookie',`amazonops_session=${token}; HttpOnly; SameSite=Strict; Path=/`);json(res,{authenticated:true});return;
      }
      if(!auth.identity(req))throw new Error('AUTH_REQUIRED');
      if(!source||!runtime){json(res,{ready:false});return;}
      const body=req.method==='POST'?await readBody(req):{};
      if(path==='seed'){
        const forecast=business.command('main','forecast',{requestId:'initial',store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily:5,manualReason:'Synthetic fixture'} ) as {id:string};
        const inventory=business.command('main','inventory',{forecastId:forecast.id,physicalSku:'A',asOf:'2026-11-05',available:12,reserved:0,inbound:[],leadDays:{purchase:1,transport:2,receiving:1},safetyDays:2,horizon:7,demandFactors:[]});
        json(res,inventory);return;
      }
      if(path==='watch'){json(res,await source.followups.createWatch('main',body as any));return;}
      if(path==='change'){json(res,business.command('main','forecast',{requestId:String(body.requestId),store:'Synthetic',site:'US',listing:'A',asOf:'2026-11-05',manualDaily:Number(body.quantity),manualReason:'Synthetic changed demand'}));return;}
      if(path==='action'){json(res,await source.action('main',body as any));return;}
      if(path==='rule'){json(res,await source.followups.configureRule('main',body as any,{autoAvailable:true}));return;}
      if(path==='stop'){json(res,source.followups.stopWatch('main',body as any));return;}
      if(path==='state'){
        json(res,{ready:true,work:source.work('main'),followups:source.followups.snapshot('main',{autoAvailable:true}),
          tickets:runtime.store.tickets.list(),triggers:runtime.store.read.triggers({source:'amazonops'},0,500).items,
          decisions:runtime.store.db.prepare('SELECT value FROM decision').all().map(row=>JSON.parse(String(row.value))),
          outbox:runtime.store.db.prepare('SELECT value FROM outbox').all().map(row=>JSON.parse(String(row.value))),
          tasks:business.snapshot('main').tasks,usage:budget.lifetimeSnapshot(),owners:[runtime.engine.constructor.name,runtime.store.constructor.name,runtime.executor.constructor.name]});return;
      }
      throw new Error('NOT_FOUND');
    }catch(error){failure(res,error);}
  }}));
  const timer=setInterval(()=>{void source?.followups.pump('main').catch(error=>ctx.logger.warn('Synthetic pump pending',String(error)));},200);
  ctx.effect(()=>async()=>{clearInterval(timer);await runtime?.stop();await ctx.sessionPersistence.flush();accounting();boundary();business.close();budget.close();});
}
