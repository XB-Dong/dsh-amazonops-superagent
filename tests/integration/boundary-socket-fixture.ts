/** Isolated real HTTP/TCP child: observes boundary ownership without process error recovery. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { realpathSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Auth } from '../../packages/host/auth.ts';
import { installBoundary } from '../../packages/host/boundary.ts';

const evidence=process.argv[2];
process.on('uncaughtExceptionMonitor',(error:NodeJS.ErrnoException)=>{
  writeFileSync(join(evidence,'fatal.json'),JSON.stringify({code:error.code,message:error.message}));
});
const require=createRequire(realpathSync('node_modules/@deepseek-ai/dsh-api-gateway/package.json'));
const {WebSocketServer}=require('ws');
const ws=new WebSocketServer({noServer:true});
const auth=new Auth('synthetic-socket-password');
let cookie=`amazonops_session=${auth.login('synthetic-socket-password')}`;
let nativeUpgrades=0,nativeRequests=0,nativeErrors=0;
const server=createServer((req,res)=>{
  nativeRequests++;
  if(req.url==='/amazonops/api/logout'){
    auth.logout(req);for(const client of ws.clients)client.close(1001,'peer left');res.end('{}');return;
  }
  res.end('native-owner');
});
server.on('upgrade',(req,socket,head)=>{
  nativeUpgrades++;
  // A protocol owner's existing local listener must remain in control of accepted sockets.
  const onError=()=>{nativeErrors++;socket.destroy();};socket.on('error',onError);
  socket.once('close',()=>socket.off('error',onError));
  ws.handleUpgrade(req,socket,head,(client:any)=>{
    client.on('error',()=>{});
    client.on('message',(message:Buffer)=>client.send(message));
  });
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const dispose=installBoundary(server,origin,auth);
process.on('message',async(message:{command?:string;id?:number})=>{
  if(message.command==='stats')process.send?.({id:message.id,nativeUpgrades,nativeRequests,nativeErrors});
  if(message.command==='login'){cookie=`amazonops_session=${auth.login('synthetic-socket-password')}`;process.send?.({id:message.id,cookie});}
  if(message.command==='stop'){
    for(const client of ws.clients)client.terminate();dispose();server.closeAllConnections();server.close(()=>process.exit(0));
  }
});
process.send?.({ready:true,origin,cookie});
