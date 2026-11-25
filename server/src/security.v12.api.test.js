import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

test('v12 live HTTP safeguards and chat continuity', {timeout:20000}, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'oa-v12-http-'));
  fs.mkdirSync(path.join(folder,'data'));
  fs.writeFileSync(path.join(folder,'data/docs.json'),'[]');
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(ok=>listener.close(ok));
  const root=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[path.resolve('src/index.js')],{
    cwd:folder,stdio:['ignore','pipe','pipe'],env:{...process.env,
      PORT:String(port),NODE_ENV:'production',CORS_ORIGINS:'https://frontend.test',TRUST_PROXY:'',
      LOGIN_RATE_MAX:'2',CHAT_RATE_MAX:'2',FEEDBACK_RATE_MAX:'2',
      GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',
      ADMIN_EMAIL:'admin@test.invalid',ADMIN_PASSWORD:'validPass1!2026',OA_TEST_SANDBOX:'1',
      DOTENV_CONFIG_PATH:path.join(folder,'not-existing.env')}
  });
  let stderr='';child.stderr.on('data',d=>stderr+=d.toString());
  async function req(url,method='GET',body,headers={}) {
    const raw=await fetch(root+url,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
    const text=await raw.text();let obj;try{obj=JSON.parse(text)}catch{obj=text};return {status:raw.status,body:obj,headers:raw.headers};
  }
  try {
    let ready=false;
    for(let i=0;i<50;i++){try{if((await req('/api/health')).status===200){ready=true;break;}}catch{};if(child.exitCode!==null)break;await sleep(80);}
    assert.ok(ready,stderr);
    const badOrigin=await req('/api/chat','POST',{message:'Привіт'}, {'Origin':'https://evil.test'});
    assert.equal(badOrigin.status,403);
    const goodOrigin=await req('/api/health','GET',undefined,{'Origin':'https://frontend.test'});
    assert.equal(goodOrigin.status,200);
    assert.equal(goodOrigin.headers.get('access-control-allow-origin'),'https://frontend.test');
    const preflight=await req('/api/chat','OPTIONS',undefined,{'Origin':'https://frontend.test','Access-Control-Request-Method':'POST'});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-methods').includes('POST'),true);

    const first=await req('/api/chat','POST',{message:'Привіт'});
    assert.equal(first.status,200); assert.ok(first.body.answer);
    const second=await req('/api/chat','POST',{message:'Добрий день'});
    assert.equal(second.status,200);
    const rate=await req('/api/chat','POST',{message:'Привіт'});
    assert.equal(rate.status,429);assert.equal(rate.body.code,'rate_limited');
    assert.ok(Number(rate.headers.get('retry-after'))>=1);
    const feedback=await req('/api/chat/feedback','POST',{responseId:first.body.responseId,value:'up'});
    assert.equal(feedback.status,200,'feedback must not share the chat limiter');
    const next=await req('/api/chat/feedback','POST',{responseId:second.body.responseId,value:'down'});
    assert.equal(next.status,200);
    const third=await req('/api/chat/feedback','POST',{responseId:first.body.responseId,value:'up'});
    assert.equal(third.status,429);

    const tokenReply=await req('/api/admin/login','POST',{email:'admin@test.invalid',password:'validPass1!2026'});
    assert.equal(tokenReply.status,200);assert.ok(tokenReply.body.token);
    const auth={Authorization:`Bearer ${tokenReply.body.token}`};
    const badQa=await req('/api/admin/qa','POST',{question:[],answer:{}},auth);
    assert.equal(badQa.status,400);
    const goodQa=await req('/api/admin/qa','POST',{question:'Запитання?',answer:'Відповідь'},auth);
    assert.equal(goodQa.status,200);
    const badQuick=await req('/api/admin/quick','PUT',{items:[{},'hi']},auth);
    assert.equal(badQuick.status,400);
    const failLogin=await req('/api/admin/login','POST',{email:'admin@test.invalid',password:'wrong'});
    assert.equal(failLogin.status,401);
    const blockedLogin=await req('/api/admin/login','POST',{email:'admin@test.invalid',password:'wrong'});
    assert.equal(blockedLogin.status,429);
  } finally {
    child.kill();await Promise.race([once(child,'exit').catch(()=>{}),sleep(700)]);
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
