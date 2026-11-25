import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../src/index.js',import.meta.url));
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function sandbox(t,{seed={},env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-http-')),data=path.join(dir,'data');fs.mkdirSync(data);
 fs.writeFileSync(path.join(data,'docs.json'),JSON.stringify(seed.docs||[{id:1,url:'https://www.oa.edu.ua/ua/contacts',title:'Контакти',chunk:'Адреса університету: місто Острог, вулиця Семінарська, 2. Електронна адреса для загальних звернень: osa@oa.edu.ua.'}]));
 const base={qas:[],chats:[],feedback:[],quick:[],quickByLang:{uk:[],en:[]},model:{calls:[],events:[],headers:{}},schedule:{hour:2,minute:0,lastRunDate:null}};
 fs.writeFileSync(path.join(data,'faq.json'),JSON.stringify({...base,...seed.faq}));fs.writeFileSync(path.join(data,'reports.json'),JSON.stringify(seed.reports||{weekly:[],monthly:[]}));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));const host=`http://127.0.0.1:${port}`;
 let child,errors='';const email='audit@example.invalid',password='Safe-test-password22!';
 async function start(){child=spawn(process.execPath,[entry],{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OA_TEST_SANDBOX:'1',DATABASE_URL:'',DOTENV_CONFIG_PATH:path.join(dir,'missing.env'),NODE_ENV:'test',CORS_ORIGINS:host,ADMIN_EMAIL:email,ADMIN_PASSWORD:password,ADMIN_PASSWORD_HASH:'',GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',CHAT_RATE_MAX:'5000',LOGIN_REQUEST_MAX:'5000',...env}});child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){try{if((await fetch(host+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)break;await pause(60);}throw Error('Isolated server did not start: '+errors.slice(-1000));}
 async function stop(){if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(1800)]);}}
 async function request(route,{method='GET',body,token,headers={}}={}){const response=await fetch(host+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(6000)});const text=await response.text();let json;try{json=JSON.parse(text)}catch{}return {status:response.status,json,text,headers:response.headers};}
 const login=()=>request('/api/admin/login',{method:'POST',body:{email,password}});
 t.after(async()=>{await stop();const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'oa-v22-http-'))throw Error('Unsafe test cleanup path');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await start();return {dir,data,host,email,password,start,stop,request,login};
}
