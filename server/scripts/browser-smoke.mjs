// Reproducible production-build smoke test: isolated JSON, synthetic credentials, no AI keys.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {sandbox,pause} from '../testSupport/sandbox.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const executable=[process.env.OA_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(p=>fs.existsSync(p));
if(!executable)throw Error('Set OA_BROWSER_PATH to Chrome/Chromium/Edge. Build web first.');
if(!fs.existsSync(path.join(root,'web/dist/admin.html')))throw Error('Run npm run build in web first.');
const cleanups=[],results=[],errors=[];let chrome,ws;
const out=path.join(root,'.launcher','v22-browser');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-browser-'));
try{
 const sample=type=>({id:'browser-'+type,type,periodStart:'2026-11-01T00:00:00Z',periodEnd:'2026-11-30T23:59:59Z',periodLabel:'Синтетичний звіт V22',createdAt:new Date().toISOString(),summary:{totalRequests:10,faqResponses:5,llmResponses:4,errorResponses:1},topQuestions:[],topIntents:[]});
 const app=await sandbox({after:fn=>cleanups.push(fn)},{seed:{reports:{weekly:[sample('weekly')],monthly:[sample('monthly')]}},env:{NODE_ENV:'production',OA_WEB_DIST_DIR:path.join(root,'web/dist'),LOGIN_RATE_MAX:'2',LOGIN_BLOCK_MS:'1200'}});
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const args=[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--headless=new','--disable-gpu','--disable-software-rasterizer','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','--password-store=basic','about:blank'];
 if(process.env.OA_BROWSER_NO_SANDBOX==='1')args.unshift('--no-sandbox','--disable-gpu-sandbox');
 chrome=spawn(executable,args,{windowsHide:true,stdio:'ignore'});chrome.on('error',e=>errors.push(e.message));
 let target;for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(80);}
 if(!target)throw Error('Browser did not expose a loopback CDP target.');
 ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');let seq=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},12000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 async function until(expression){for(let i=0;i<80;i++){if(await evaluate(`Boolean(${expression})`))return;await pause(80);}const state=await evaluate(`({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,800),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,status:r.responseStatus}))})`);throw Error('UI condition timed out: '+expression+' '+JSON.stringify(state));}
 const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.focus();b.click()})()`);
 const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 async function key(name,code){await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,...(name==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code});}
 async function check(name,fn){await fn();results.push({name,pass:true});console.log('PASS '+name);}
 async function shot(name){const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
 await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:app.host+'/admin.html'});await until(`document.querySelector('.auth-input')`);
 await evaluate(`(()=>{const original=window.fetch;window.fetch=async function(...args){const response=await original.apply(this,args);if(String(args[0]).endsWith('/api/admin/login')&&response.ok)window.__v22token=(await response.clone().json()).token;return response;}})()`);
 await check('login Enter; HTTP 429 displays cooldown',async()=>{
  await fill('input[type=email]',app.email);await fill('input[type=password]','incorrect');await evaluate(`document.querySelector('input[type=password]').focus()`);await key('Enter',13);await until(`document.body.innerText.includes('Невірний')`);await key('Enter',13);await until(`document.body.innerText.includes('Повторіть спробу через')`);await pause(2200);await fill('input[type=password]',app.password);await key('Enter',13);await until(`document.querySelector('.tab-bar')`);
 });
 const token=await evaluate('window.__v22token');assert.ok(token);
 const tabs=await evaluate(`[...document.querySelectorAll('.tab-bar button')].map(b=>b.textContent.trim())`);assert.equal(tabs.length,6);
 await check('all six admin tabs render at desktop width',async()=>{for(const tab of tabs){await click(tab);await pause(200);assert.ok(await evaluate(`Boolean(document.querySelector('.tab-section'))`));assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),tab);}});
 await click(tabs[0]);await shot('admin-dark');
 await check('light theme persists',async()=>{await click('Світла тема');assert.equal(await evaluate(`localStorage.getItem('adminTheme')`),'light');await shot('admin-light');});
 await check('report keyboard switch and DOCX/HTML downloads',async()=>{
  await click(tabs[1]);await until(`document.querySelector('.reports-type-switch')`);await evaluate(`document.querySelector('.reports-type-switch [aria-selected=true]').focus()`);
  const before=await evaluate(`document.querySelector('.reports-type-switch [aria-selected=true]').textContent`);await key('ArrowRight',39);assert.notEqual(await evaluate(`document.querySelector('.reports-type-switch [aria-selected=true]').textContent`),before);
  const downloads=path.join(out,'downloads');fs.mkdirSync(downloads,{recursive:true});for(const name of fs.readdirSync(downloads))if(name.endsWith('.docx')||name.endsWith('.html'))fs.unlinkSync(path.join(downloads,name));
  await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await click('↓ Word (.docx)');await click('↓ HTML');await pause(500);const files=fs.readdirSync(downloads);assert.ok(files.some(f=>f.endsWith('.docx')));assert.ok(files.some(f=>f.endsWith('.html')));
 });
 await check('FAQ create; confirmation focus trap, Escape and focus return',async()=>{
  await click(tabs.find(t=>t.includes('Автовідповіді')));await fill('.qa-left textarea:first-of-type','Синтетичний браузерний запис');await fill('.qa-left textarea:nth-of-type(2)','Синтетична відповідь для локального тесту.');await click('Зберегти');await until(`document.querySelector('.qa-list').innerText.includes('Синтетичний браузерний запис')`);
  await fill('.qa-left textarea:first-of-type','Незбережене тестове питання');await click('Скасувати');await until(`document.querySelector('[role=alertdialog]')`);assert.ok(await evaluate(`document.querySelector('[role=alertdialog]').contains(document.activeElement)`));
  await key('Tab',9);assert.ok(await evaluate(`document.querySelector('[role=alertdialog]').contains(document.activeElement)`));await key('Escape',27);await until(`!document.querySelector('[role=alertdialog]')`);assert.equal(await evaluate(`document.activeElement.textContent.trim()`),'Скасувати');
 });
 await check('mobile six tabs and FAQ search stay within viewport',async()=>{
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});for(const tab of tabs){await click(tab);await pause(150);assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`),tab);}
  await click(tabs.find(t=>t.includes('Автовідповіді')));assert.ok(await evaluate(`(()=>{const e=document.querySelector('.qa-search'),r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.right<=p.right+1})()`));await shot('faq-mobile');
 });
 await check('logout revokes current bearer token',async()=>{await click('Вийти');await until(`document.querySelector('input[type=password]')`);assert.equal(await evaluate(`document.querySelector('input[type=password]').value`),'');assert.equal((await app.request('/api/admin/stats',{token})).status,401);});
 await check('chat mobile keyboard and literal unsafe markup',async()=>{
  await cdp('Page.navigate',{url:app.host+'/'});await until(`document.querySelector('.composer')`);await fill('.composer textarea,.composer input','<img src=x onerror="window.__v22xss=1">');await evaluate(`document.querySelector('.composer').requestSubmit()`);await until(`document.querySelectorAll('.bubble.assistant').length>=2&&!document.querySelector('.oa-typing')`);assert.equal(await evaluate('Boolean(window.__v22xss)'),false);assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+2`));await shot('chat-mobile');
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({browser:(await cdp('Browser.getVersion')).product,results,errors},null,2));
 await cdp('Browser.close').catch(()=>{});
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:error.message,results,errors},null,2));throw error;}
finally{ws?.close();chrome?.kill();for(const cleanup of cleanups.reverse())await cleanup();await pause(250);const target=path.resolve(profile);if(target.startsWith(path.resolve(os.tmpdir())+path.sep+'oa-v22-browser-'))try{fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{console.error('Isolated browser profile still locked; retained in OS temp.');}}
