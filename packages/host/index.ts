import { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-session-persistence';
import { join } from 'node:path';
import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { Server } from 'node:http';
import { Business,ModelBudget,createRecoveryPoint } from '../business/index.ts';
import type { Runtime,OperationsExtensions } from '../../vendor/superagent/src/extension.ts';
import { Auth } from './auth.ts';
import { installBoundary } from './boundary.ts';
import { installNativeAccess } from './native-access.ts';
import { installAccounting } from './accounting.ts';
import { AgentTools } from './agent-tools.ts';
import { WorkbenchSource } from './source.ts';
import { json,readBody,failure,loginPage } from './http.ts';

export const name='amazonops-workbench';
export const inject=['webServer','llm','sessionPersistence'];
export type Config={dataDir:string;password:string;live?:boolean;modelAccount?:'test'|'runtime'};
export function apply(ctx:Context,config:Config):void {
  if(!config.dataDir)throw new Error('DATA_DIRECTORY_REQUIRED');
  mkdirSync(config.dataDir,{recursive:true});
  const business=new Business(config.dataDir);
  const auth=new Auth(config.password);
  const budget=new ModelBudget(join(config.dataDir,'model-budget.sqlite'),
    {maxCalls:null,maxInputTokens:null,maxOutputTokens:null,maxTotalTokens:null},
    {account:config.modelAccount==='runtime'?'amazonops-runtime':'amazonops-test',period:config.modelAccount==='runtime'?'daily':'lifetime'});
  const accounting=installAccounting(ctx,budget,{live:config.live===true,maxRequestsPerTurn:12,defaultOutputTokens:2048});
  const origin=ctx.webServer.getOrigin();
  const server=(ctx.webServer as unknown as {server:Server}).server;
  const offBoundary=installBoundary(server,origin,auth);
  let runtime:Runtime|undefined;let source:WorkbenchSource|undefined;let maintenance=false;
  const tools=new AgentTools(business,()=>{if(!runtime)throw new Error('RUNTIME_NOT_READY');return runtime;});
  const hooks:OperationsExtensions={tools:(agent,ticket)=>tools.tools(agent,ticket),onAgent:(agent,ticket)=>tools.onAgent(agent,ticket)};
  ctx.provide('amazonopsHooks',hooks);
  let offAccess:(()=>void)|undefined;
  ctx.inject(['connection','remoteAccess'],child=>{
    offAccess=installNativeAccess(child,auth,origin,scope=>source?.sessions(scope)??new Set());
    child.effect(()=>()=>{offAccess?.();offAccess=undefined;});
  });
  ctx.inject(['orchestrator'],async child=>{
    const next=child.get('orchestrator') as unknown as Runtime;
    await next.ready;
    runtime=next;source=new WorkbenchSource(next,business);
    const offSource=source.register();
    child.effect(()=>()=>{offSource();if(runtime===next){runtime=undefined;source=undefined;}});
  });
  const offChange=business.onChange(()=>{source?.revokeDeleted();ctx.get('remoteAccess')?.invalidate();});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/amazonops/login',handler:(_req,res)=>loginPage(res)}));
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/amazonops/api',handler:async(req,res)=>{
    try{
      const path=new URL(req.url??'/',origin).pathname.slice('/amazonops/api/'.length);
      if(path==='login'&&req.method==='POST'){
        const body=await readBody(req);const token=auth.login(body.password,req.socket.remoteAddress);
        res.setHeader('set-cookie',`amazonops_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        json(res,{authenticated:true});return;
      }
      const identity=auth.identity(req);if(!identity)throw new Error('AUTH_REQUIRED');
      const scope=identity.scope;
      if(maintenance&&path!=='status'&&path!=='logout')throw new Error('MAINTENANCE_IN_PROGRESS');
      if(path==='logout'&&req.method==='POST'){
        auth.logout(req);res.setHeader('set-cookie','amazonops_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,{authenticated:false});return;
      }
      if(path==='status'&&req.method==='GET'){
        const live=config.live===true&&!!source;
        json(res,{authenticated:true,scope,live,version:'0.1.0',modelState:!live?'disabled':budget.exhausted()?'budget_exhausted':
          accounting.state.lastFailure&&(!accounting.state.lastSuccess||accounting.state.lastFailure>accounting.state.lastSuccess)?'last_failed':accounting.state.lastSuccess?'last_succeeded':'enabled_unverified',
          budget:{used:budget.snapshot(),limits:budget.limits,policy:budget.policy,lifetime:budget.lifetimeSnapshot()}});return;
      }
      if(path==='snapshot'&&req.method==='GET'){json(res,business.snapshot(scope));return;}
      if(path==='work'&&req.method==='GET'){json(res,source?.work(scope)??{tickets:[],messages:[]});return;}
      if(path.startsWith('actions/')&&path!=='actions/backup'&&req.method==='POST'){
        const action=path.slice(8);const body=await readBody(req);
        json(res,business.command(scope,action,body));return;
      }
      if(path==='messages'&&req.method==='POST'){
        if(!source||!config.live)throw new Error('MODEL_OFFLINE');
        const body=await readBody(req);
        json(res,await source.submit(scope,String(body.text??''),String(body.requestId??''),typeof body.threadId==='string'?body.threadId:undefined));return;
      }
      if(path==='cancel'&&req.method==='POST'){
        if(!source)throw new Error('RUNTIME_NOT_READY');const body=await readBody(req);
        source.cancel(scope,String(body.ticketId??''));json(res,{status:'cancelled'});return;
      }
      if((path==='backup'||path==='actions/backup')&&req.method==='POST'){
        if(!runtime)throw new Error('RUNTIME_NOT_READY');
        const checkpoint=(runtime as unknown as {checkpoint?<T>(capture:()=>Promise<T>):Promise<T>}).checkpoint;
        if(!checkpoint)throw new Error('CHECKPOINT_NOT_READY');
        const previous=runtime;
        maintenance=true;
        try{
          const value=await checkpoint.call(runtime,async()=>{
            await ctx.sessionPersistence.flush();
            if(!existsSync(business.store.ledgerPath))writeFileSync(business.store.ledgerPath,'',{mode:0o600});
            return createRecoveryPoint(business.store,budget,config.dataDir,join(config.dataDir,'backups'));
          }) as Awaited<ReturnType<typeof createRecoveryPoint>>;
          json(res,{id:value.directory.split(/[/\\]/).at(-1),files:value.manifest.files.length});
        }finally{
          const deadline=Date.now()+15000;
          while((!runtime||runtime===previous||!source)&&Date.now()<deadline)await delay(25);
          maintenance=!runtime||runtime===previous||!source;
          if(maintenance)ctx.logger.error('Native recovery is not ready; workbench remains in maintenance.');
        }
        return;
      }
      throw new Error('NOT_FOUND');
    }catch(error){failure(res,error);}
  }}));
  const worker=setInterval(()=>{if(!maintenance){try{business.tick('main');}catch{ctx.logger.warn('Business background work is pending after a recoverable error.');}}},3000);
  worker.unref();
  ctx.effect(()=>async()=>{
    clearInterval(worker);offChange();await runtime?.stop();await ctx.sessionPersistence.flush();accounting();
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    offAccess?.();offBoundary();business.close();budget.close();
  });
}
