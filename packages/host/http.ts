import type { IncomingMessage, ServerResponse } from 'node:http';
export function json(res:ServerResponse,value:unknown,status=200):void {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
export async function readBody(req:IncomingMessage):Promise<Record<string,unknown>> {
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;
    if(size>2_000_000)throw new Error('BODY_TOO_LARGE');chunks.push(bytes);}
  let value:unknown;
  try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('INVALID_JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_JSON');
  return value as Record<string,unknown>;
}
export function failure(res:ServerResponse,error:unknown):void {
  if(res.headersSent){res.end();return;}
  const raw=error instanceof Error?error.message:'';
  const code=/^[A-Z][A-Z0-9_]{1,70}$/.test(raw)?raw:'OPERATION_FAILED';
  const status=code==='NOT_FOUND'?404:code.includes('AUTH_REQUIRED')?401:
    /FORBIDDEN|REVOKED/.test(code)?403:/CONFLICT|BUSY|MAINTENANCE/.test(code)?409:400;
  json(res,{error:code},status);
}
export function loginPage(res:ServerResponse):void {
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>cc 运营工作台</title>
<style>body{font:16px system-ui;background:#f5f7fb;color:#17233b;display:grid;place-items:center;min-height:95vh}main{background:white;padding:40px;border-radius:20px;box-shadow:0 12px 50px #1231;max-width:390px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:15px;border-radius:9px;border:1px solid #ccd5e2}button{background:#1d55b9;color:white;border:0}p{line-height:1.7;color:#556178}#error{color:#b32130}</style>
<main><h1>cc，你好</h1><p>打开你的运营工作台，记录任务、查看日历，让经验留下。</p><form><label>工作台密码<input name="password" type="password" autocomplete="current-password" required></label><button>进入工作台</button><p id="error" role="alert"></p></form></main>
<script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/amazonops/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:new FormData(e.target).get('password')})});if(r.ok)location.href='/?panel=amazonops';else document.getElementById('error').textContent='登录未完成，请核对密码后重试。'};</script></html>`);
}
