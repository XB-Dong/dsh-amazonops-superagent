import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Auth } from './auth.ts';

export function allowedRequest(req: Pick<IncomingMessage,'headers'|'method'|'url'>, origin: string, auth: Auth): number {
  if (req.headers.host !== new URL(origin).host) return 403;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== origin) return 403;
  if (req.headers.origin && req.headers.origin !== origin) return 403;
  let path:string;
  try{
    const url=new URL(req.url??'/',origin);
    if(url.origin!==origin)return 403;
    path=url.pathname;
  }catch{return 400;}
  if ((path==='/health' || path==='/ready') && (req.method==='GET' || req.method==='HEAD')) return 200;
  if (path==='/amazonops/login' || path==='/amazonops/api/login') return 200;
  if (!auth.identity(req)) return 401;
  if (path.startsWith('/orchestrator') || path==='/api/file') return 403;
  return 200;
}

// DSH rc.3 exposes no global ingress middleware. This version-locked adapter
// gates its existing Node listeners, never dispatching rejected requests.
export function installBoundary(server: Server,origin: string,auth: Auth): () => void {
  const requests=server.listeners('request');
  const upgrades=server.listeners('upgrade');
  if (requests.length!==1) throw new Error('NATIVE_INGRESS_CONTRACT_CHANGED');
  server.removeAllListeners('request'); server.removeAllListeners('upgrade');
  const request=(req: IncomingMessage,res: ServerResponse) => {
    const status=allowedRequest(req,origin,auth);
    if (status!==200) {
      if (status===401 && (req.url==='/' || req.url?.startsWith('/?'))) {
        res.writeHead(303,{location:'/amazonops/login','cache-control':'no-store'}); res.end();
      } else {
        res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({error:status===401?'AUTH_REQUIRED':'ACCESS_FORBIDDEN'}));
      }
      return;
    }
    for (const handler of requests) handler.call(server,req,res);
  };
  const upgrade=(req: IncomingMessage,socket: Duplex,head: Buffer) => {
    // Removing Node's HTTP parser transfers transport ownership here before a
    // protocol owner can attach its listeners. Even a rejected peer can reset.
    // Keep this socket-local cleanup through close; native accepted handlers
    // still receive the same request/socket/head and their own error events.
    const close=()=>socket.destroy();
    socket.on('error',close);
    socket.once('close',()=>socket.off('error',close));
    const status=allowedRequest(req,origin,auth);
    if (status!==200) {
      socket.end(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\n\r\n`,close);
      return;
    }
    for (const handler of upgrades) handler.call(server,req,socket,head);
  };
  server.on('request',request); server.on('upgrade',upgrade);
  return ()=>{
    server.off('request',request); server.off('upgrade',upgrade);
    for (const handler of requests) server.on('request',handler as never);
    for (const handler of upgrades) server.on('upgrade',handler as never);
  };
}
