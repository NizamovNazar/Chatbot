import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {sandbox,pause} from '../testSupport/sandbox.mjs';
import {persistKnowledge} from './knowledgeStore.js';

test('V22 HTTP failed login persists across restart; logout and expiry revoke tokens', {timeout:20000},async t=>{
 const app=await sandbox(t,{env:{LOGIN_RATE_MAX:'2',LOGIN_ACCOUNT_MAX:'4',LOGIN_BLOCK_MS:'3000',ADMIN_SESSION_MS:'400'}});
 const bad=()=>app.request('/api/admin/login',{method:'POST',body:{email:app.email,password:'incorrect'}});
 assert.equal((await bad()).status,401);assert.equal((await bad()).status,429);
 await app.stop();await app.start();const blocked=await app.login();assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>=1);
 await pause(3100);const good=await app.login();assert.equal(good.status,200);const token=good.json.token;
 assert.equal((await app.request('/api/admin/logout',{method:'POST',token})).status,200);assert.equal((await app.request('/api/admin/stats',{token})).status,401);
 const next=await app.login();await pause(450);assert.equal((await app.request('/api/admin/stats',{token:next.json.token})).status,401);
});

test('V22 all FAQ/quick/schedule/moderation/feedback mutations reject without publishing on failed storage',{timeout:15000},async t=>{
 const chat={id:'saved-answer',question:'Контрольна відповідь аудиту',answer:'Початкова синтетична відповідь.',created_at:new Date().toISOString(),meta:{sourceType:'faq',lang:'uk'}};
 const app=await sandbox(t,{seed:{faq:{qas:[{id:1,question:'Тестове запитання',answer:'Стара відповідь',lang:'uk',enabled:1}],chats:[chat],feedback:[{id:'review',responseId:chat.id,question:chat.question,answer:chat.answer,value:'down',lang:'uk',status:'pending'}]}}});
 const token=(await app.login()).json.token;const file=path.join(app.data,'faq.json');const disk=fs.readFileSync(file,'utf8');
 const before={qa:(await app.request('/api/admin/qa',{token})).json,quick:(await app.request('/api/admin/quick',{token})).json,reviews:(await app.request('/api/admin/reviews',{token})).json};
 fs.renameSync(file,file+'.original');fs.mkdirSync(file);
 const mutations=[['/api/admin/qa','POST',{question:'Rejected-create',answer:'Rejected answer'}],['/api/admin/qa/1','PUT',{question:'Rejected-edit',answer:'Changed answer',enabled:true}],['/api/admin/qa/1','DELETE'],['/api/admin/quick','PUT',{items:['Rejected quick']}],['/api/admin/reindex/schedule','PUT',{hour:5,minute:13}],['/api/chat/feedback','POST',{responseId:chat.id,value:'up'}],['/api/admin/reviews/review/action','POST',{action:'publish',answer:'Rejected published answer with enough text',addToQuick:true}]];
 for(const [route,method,body] of mutations)assert.equal((await app.request(route,{method,body,token})).status,503,route);
 assert.equal((await app.request('/api/admin/analytics/reset',{method:'POST',token,body:{email:app.email,password:app.password}})).status,503);
 assert.deepEqual((await app.request('/api/admin/qa',{token})).json,before.qa);assert.deepEqual((await app.request('/api/admin/quick',{token})).json,before.quick);assert.deepEqual((await app.request('/api/admin/reviews',{token})).json,before.reviews);
 fs.renameSync(file,file+'.failed-directory');fs.renameSync(file+'.original',file);assert.equal(fs.readFileSync(file,'utf8'),disk);
 await app.request('/api/admin/qa',{method:'POST',token,body:{question:'Accepted-create',answer:'Accepted answer'}});const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.qas.length,2);assert.ok(!saved.qas.some(x=>x.question.startsWith('Rejected')));
 await app.stop();await app.start();const newToken=(await app.login()).json.token;assert.equal((await app.request('/api/admin/qa',{token:newToken})).json.length,2);
});

test('V22 reports reject failed writes; optional enabled is retained and concurrent creates have unique IDs',{timeout:15000},async t=>{
 const app=await sandbox(t,{seed:{faq:{qas:[{id:1,question:'Початкове питання',answer:'Початкова відповідь',enabled:1,lang:'uk'}]}}});const token=(await app.login()).json.token;
 assert.equal((await app.request('/api/admin/qa/1',{method:'PUT',token,body:{question:'Оновлене питання',answer:'Оновлена відповідь'}})).status,200);assert.equal((await app.request('/api/admin/qa',{token})).json[0].enabled,1);
 const file=path.join(app.data,'reports.json');fs.renameSync(file,file+'.original');fs.mkdirSync(file);
 assert.equal((await app.request('/api/admin/reports/generate',{method:'POST',token,body:{type:'weekly'}})).status,503);assert.equal((await app.request('/api/admin/reports',{token})).json.items.length,0);
 fs.renameSync(file,file+'.failed-directory');fs.renameSync(file+'.original',file);
 assert.equal((await app.request('/api/admin/reports/generate',{method:'POST',token,body:{type:'weekly'}})).status,200);
 await Promise.all(Array.from({length:10},(_,i)=>app.request('/api/admin/qa',{method:'POST',token,body:{question:'Concurrent question '+i,answer:'Answer '+i}})));
 const rows=(await app.request('/api/admin/qa',{token})).json;assert.equal(rows.length,11);assert.equal(new Set(rows.map(r=>r.id)).size,11);
});

test('V22 analytics types, Kyiv date boundaries, CSV and real session IDs agree',{timeout:15000},async t=>{
 const chats=['extractive','verified_local','multi_extract','no_context','navigation','conversation','clarification'].map((sourceType,i)=>({id:'history-'+i,question:'Історичний запит '+i,answer:'Контрольний текст',created_at:'2026-11-23T22:30:00Z',meta:{sourceType,lang:'uk',fallback:sourceType==='multi_extract'}}));
 const app=await sandbox(t,{seed:{faq:{chats}}});const token=(await app.login()).json.token;
 for(const c of chats)assert.equal((await app.request('/api/admin/analytics/explore?source='+c.meta.sourceType,{token})).json.total,1);
 const range='?from=2026-11-24&to=2026-11-24&q=Історичний';assert.equal((await app.request('/api/admin/analytics/explore'+range,{token})).json.total,7);assert.equal((await app.request('/api/admin/analytics/explore'+range+'&format=csv',{token})).text.split('\r\n').length,8);
 assert.equal((await app.request('/api/admin/analytics/explore?from=2026-99-99',{token})).status,400);
 let a=(await app.request('/api/admin/analytics',{token})).json;assert.equal(a.quality.noContext,1);assert.equal(a.quality.fallback,4);assert.equal(a.behavior.knownSessions,0);assert.equal(a.behavior.unknownSessionRequests,7);assert.equal(a.behavior.avgSessionLength,null);
 for(const sessionId of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'])for(let i=0;i<2;i++)assert.equal((await app.request('/api/chat',{method:'POST',body:{message:'Вітаю',sessionId}})).status,200);
 a=(await app.request('/api/admin/analytics',{token})).json;assert.equal(a.behavior.knownSessions,2);assert.equal(a.behavior.avgSessionLength,2);assert.equal(a.behavior.unknownSessionRequests,7);
});

test('V22 X-Forwarded-For is ignored directly and honored only behind the configured proxy',{timeout:15000},async t=>{
 const app=await sandbox(t,{env:{LOGIN_RATE_MAX:'1',LOGIN_ACCOUNT_MAX:'5',TRUST_PROXY:''}});
 assert.equal((await app.request('/api/admin/login',{method:'POST',body:{email:'missing1@invalid.test',password:'wrong'},headers:{'X-Forwarded-For':'1.1.1.1'}})).status,429);
 assert.equal((await app.request('/api/admin/login',{method:'POST',body:{email:app.email,password:app.password},headers:{'X-Forwarded-For':'2.2.2.2'}})).status,429);
 const proxy=await sandbox(t,{env:{LOGIN_RATE_MAX:'1',LOGIN_ACCOUNT_MAX:'5',TRUST_PROXY:'1'}});
 await proxy.request('/api/admin/login',{method:'POST',body:{email:'missing@invalid.test',password:'wrong'},headers:{'X-Forwarded-For':'1.1.1.1'}});
 assert.equal((await proxy.request('/api/admin/login',{method:'POST',body:{email:proxy.email,password:proxy.password},headers:{'X-Forwarded-For':'2.2.2.2'}})).status,200);
});

test('V22 auth storage loss fails closed and reset reauthentication shares the failed-login budget',{timeout:15000},async t=>{
 const app=await sandbox(t,{env:{LOGIN_RATE_MAX:'2'}});const token=(await app.login()).json.token;
 const reset=()=>app.request('/api/admin/analytics/reset',{method:'POST',token,body:{email:app.email,password:'wrong'}});
 assert.equal((await reset()).status,401);assert.equal((await reset()).status,429);assert.equal((await app.login()).status,429);
 const file=path.join(app.data,'admin_auth_v22.json');fs.renameSync(file,file+'.original');fs.mkdirSync(file);
 assert.equal((await app.login()).status,503);
});

test('V22 corrupt JSON aborts startup without overwriting it',{timeout:10000},async t=>{
 const app=await sandbox(t);await app.stop();const file=path.join(app.data,'faq.json');fs.writeFileSync(file,'{CORRUPT');
 await assert.rejects(()=>app.start(),/STORAGE_CORRUPT/);assert.equal(fs.readFileSync(file,'utf8'),'{CORRUPT');
});

test('V22 persisted refresh becomes retrievable by the running HTTP server',{timeout:10000},async t=>{
 const app=await sandbox(t,{env:{KNOWLEDGE_CHECK_MS:'100'}});assert.equal((await app.request('/api/ready')).status,200);
 persistKnowledge(app.data,[{id:1,url:'https://www.oa.edu.ua/ua/contacts',title:'Новий каталог бібліотеки',chunk:'Новий електронний каталог бібліотеки університету містить навчальні видання та наукові праці. Студенти можуть користуватися каталогом для пошуку книжок і перевірки наявності навчальних матеріалів.'}]);
 await pause(150);const response=await app.request('/api/chat',{method:'POST',body:{message:'Де знайти новий електронний каталог бібліотеки?'}});
 assert.equal(response.status,200);assert.match(response.json.answer,/каталог/iu);assert.equal(response.json.sources[0].url,'https://www.oa.edu.ua/ua/contacts');
});
