import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Auth } from '../../packages/host/auth.ts';
import { allowedRequest, installBoundary } from '../../packages/host/boundary.ts';

test('identity is derived from a server cookie, never a workspace header',()=>{
  const auth=new Auth('synthetic-password-for-test');
  const token=auth.login('synthetic-password-for-test');
  const headers={cookie:`amazonops_session=${token}`,'x-cc-workspace':'other'};
  assert.equal(auth.identity({headers})?.scope,'main');
  auth.logout({headers});assert.equal(auth.identity({headers}),undefined);
});
test('host and origin fences cover native routes and management is refused',()=>{
  const auth=new Auth('synthetic-password-for-test');
  const token=auth.login('synthetic-password-for-test');
  const origin='http://127.0.0.1:1234';
  const req={method:'GET',url:'/api',headers:{host:'127.0.0.1:1234'}};
  assert.equal(allowedRequest(req,origin,auth),401);
  const headers={...req.headers,cookie:`amazonops_session=${token}`};
  assert.equal(allowedRequest({...req,headers},origin,auth),200);
  assert.equal(allowedRequest({...req,method:'POST',headers},origin,auth),403);
  assert.equal(allowedRequest({...req,url:'/orchestrator/api/state',headers},origin,auth),403);
  assert.equal(allowedRequest({...req,headers:{...headers,host:'evil.test'}},origin,auth),403);
});
test('refused HTTP requests never invoke the existing native listener',async()=>{
  let dispatched=0;
  const server=createServer((_req,res)=>{dispatched++;res.end('native');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const auth=new Auth('synthetic-password-for-test');
  const dispose=installBoundary(server,origin,auth);
  try {
    const denied=await fetch(origin+'/api');assert.equal(denied.status,401);assert.equal(dispatched,0);
    const token=auth.login('synthetic-password-for-test');
    const accepted=await fetch(origin+'/api',{headers:{cookie:`amazonops_session=${token}`}});
    assert.equal(accepted.status,200);assert.equal(dispatched,1);
  } finally {dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
