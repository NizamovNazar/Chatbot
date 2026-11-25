// Opt-in REAL PostgreSQL checks. Never substitutes a mocked driver for a database.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import pg from 'pg';import dotenv from 'dotenv';
import {PostgresStore} from './postgresStore.js';import {sandbox} from '../testSupport/sandbox.mjs';
const testUrl=process.env.OA_TEST_DATABASE_URL;
test('V22 REAL PostgreSQL bootstrap, API persistence, transactions, reconnect and logical restore',{
 skip:!testUrl?'Set a separate OA_TEST_DATABASE_URL and OA_PG_TEST_CONFIRM=ISOLATED_DATABASE':false,timeout:60000
},async t=>{
 assert.equal(process.env.OA_PG_TEST_CONFIRM,'ISOLATED_DATABASE','Explicit isolated-database confirmation is required.');
 const identity=raw=>{const u=new URL(raw);return u.hostname.replace('-pooler.','.')+':'+(u.port||'5432')+u.pathname;};
 const local=fs.existsSync('.env')?dotenv.parse(fs.readFileSync('.env')):{};
 for(const working of [process.env.DATABASE_URL,local.DATABASE_URL].filter(Boolean))assert.notEqual(identity(testUrl),identity(working),'Refusing to use the working database, even with different credentials.');
 const base=new pg.Client({connectionString:testUrl,connectionTimeoutMillis:5000});await base.connect();
 const schemas=[];let store,restored,app;const stage=fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-pg-'));
 t.after(async()=>{await app?.stop();await store?.close().catch(()=>{});await restored?.close().catch(()=>{});for(const schema of schemas){if(!/^oa_v22_test_[a-f0-9]{16}$/.test(schema))throw Error('Unsafe cleanup schema');await base.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}await base.end();if(stage.startsWith(path.join(os.tmpdir(),'oa-v22-pg-')))fs.rmSync(stage,{recursive:true,force:true});});
 async function target(){const schema='oa_v22_test_'+randomBytes(8).toString('hex');schemas.push(schema);await base.query('CREATE SCHEMA '+schema);const u=new URL(testUrl);u.searchParams.set('options','-csearch_path='+schema);return {schema,env:{DATABASE_URL:u.href}};}
 const first=await target();
 fs.writeFileSync(path.join(stage,'docs.json'),JSON.stringify([{id:1,url:'https://www.oa.edu.ua/ua/contacts',title:'Контакти',chunk:'Офіційна адреса університету: місто Острог, вулиця Семінарська 2. Електронна адреса для звернень: osa@oa.edu.ua.'}]));
 fs.writeFileSync(path.join(stage,'faq.json'),JSON.stringify({qas:[{id:'private',question:'Private should not import',answer:'Private'}],chats:[{id:'private-chat'}]}));
 let opened=await PostgresStore.open(stage,first.env,{bootstrap:true});store=opened.store;assert.equal(store.imported,true);assert.equal(opened.state.faq.chats.length,0);assert.equal(opened.state.faq.qas.length,0);
 const repeat=await PostgresStore.open(stage,first.env,{bootstrap:true});assert.equal(repeat.store.imported,false);await repeat.store.close();
 app=await sandbox(t,{env:{OA_TEST_SANDBOX:'0',DATABASE_URL:first.env.DATABASE_URL}});let token=(await app.login()).json.token;
 assert.equal((await app.request('/api/admin/qa',{method:'POST',token,body:{question:'SQL integration question',answer:'SQL integration answer'}})).status,200);
 let qa=(await app.request('/api/admin/qa',{token})).json;assert.equal(qa.length,1);
 await app.request('/api/admin/qa/'+qa[0].id,{method:'PUT',token,body:{question:qa[0].question,answer:'Updated SQL answer'}});
 assert.equal((await app.request('/api/chat',{method:'POST',body:{message:qa[0].question}})).json.answer,'Updated SQL answer');
 assert.equal((await app.request('/api/admin/reports/generate',{method:'POST',token,body:{type:'weekly'}})).status,200);
 await app.stop();await app.start();token=(await app.login()).json.token;assert.equal((await app.request('/api/admin/qa',{token})).json[0].answer,'Updated SQL answer');assert.equal((await app.request('/api/admin/reports',{token})).json.items.length,1);assert.ok((await app.request('/api/admin/analytics',{token})).json.quality.total>=1);
 const before=await store.stats();await base.query('BEGIN');await base.query(`INSERT INTO ${first.schema}.oa_reports(id,report_type,position,payload) VALUES('rollback-only','weekly',0,'{}')`);await base.query('ROLLBACK');assert.equal((await store.stats()).oa_reports,before.oa_reports);
 const backup=await store.load();await store.close();await assert.rejects(()=>store.saveFaq(backup.faq));opened=await PostgresStore.open(stage,first.env);store=opened.store;assert.equal((await store.load()).faq.qas.length,1);
 const changed=JSON.parse(fs.readFileSync(path.join(stage,'docs.json'),'utf8'));changed[0].chunk+=' Оновлений публічний текст.';fs.writeFileSync(path.join(stage,'docs.json'),JSON.stringify(changed));await store.replaceKnowledgeFromFiles();assert.match((await store.load()).docs[0].chunk,/Оновлений/);
 const second=await target();const restoreOpen=await PostgresStore.open(stage,second.env,{bootstrap:true});restored=restoreOpen.store;await restored.saveFaq(backup.faq);await restored.saveReports(backup.reports);const verified=await restored.load();assert.deepEqual(verified.faq.qas,backup.faq.qas);assert.deepEqual(verified.faq.chats,backup.faq.chats);assert.deepEqual(verified.reports,backup.reports);
 await app.request('/api/admin/qa/'+qa[0].id,{method:'DELETE',token});assert.equal((await app.request('/api/admin/qa',{token})).json.length,0);
});
