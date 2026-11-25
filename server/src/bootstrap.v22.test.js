import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {__v22TestOnly} from './postgresStore.js';import {refreshKnowledge} from './refresh.js';import {createKnowledgeSearch} from './knowledge.js';import {readKnowledgeFiles} from './knowledgeStore.js';
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-bootstrap-'));
test('V22 bootstrap unit contract: explicit, idempotent, public-only and refuses occupied databases',async()=>{
 const dir=folder();fs.writeFileSync(path.join(dir,'docs.json'),JSON.stringify([{id:1,url:'https://www.oa.edu.ua/ua/contacts',chunk:'Public information'}]));fs.writeFileSync(path.join(dir,'faq.json'),'{INVALID PRIVATE FILE MUST NEVER BE READ');
 let marker=false,occupied=false;const calls=[];const db={query:async(sql,args)=>{calls.push([sql,args]);if(sql.includes('migration_v13_complete')&&sql.startsWith('SELECT'))return {rows:marker?[{payload:{schema:13}}]:[]};if(sql.includes('COUNT(*)'))return {rows:[{n:occupied?1:0}]};return {rows:[]};}};
 await assert.rejects(()=>__v22TestOnly.migrateInitial(db,dir),/DATABASE_NOT_BOOTSTRAPPED/);
 assert.equal(await __v22TestOnly.migrateInitial(db,dir,{bootstrap:true}),true);assert.ok(!calls.some(([sql])=>sql.includes('INSERT INTO oa_chat_entries')));marker=true;assert.equal(await __v22TestOnly.migrateInitial(db,dir,{bootstrap:true}),false);
 marker=false;occupied=true;const start=calls.length;await assert.rejects(()=>__v22TestOnly.migrateInitial(db,dir,{bootstrap:true}),/Existing data/);assert.ok(!calls.slice(start).some(([sql])=>sql.startsWith('DELETE')));
});
test('V22 refresh to persistence to retrieval, with mocked HTTP and explicit SQL synchronization contract',async()=>{
 const dir=folder(),url='https://www.oa.edu.ua/ua/resources/library';const events=[];
 const fetchPage=async()=>({status:200,headers:{'content-type':'text/html'},data:Buffer.from('<html><title>Наукова бібліотека</title><main><h1>Новий каталог бібліотеки</h1><p>Наукова бібліотека університету відкрила новий електронний каталог. Студенти можуть знайти навчальні видання, наукові праці та довідкові матеріали. Новий каталог бібліотеки доступний для пошуку книжок.</p></main></html>')});
 const result=await refreshKnowledge({dataDir:dir,urls:[url],fetchPage,sqlEnabled:true,prime:async()=>events.push('prime'),sync:async()=>{events.push('sync');assert.ok(readKnowledgeFiles(dir).docs.length);}});
 assert.equal(result.updated,1);assert.deepEqual(events,['prime','sync']);const engine=createKnowledgeSearch(readKnowledgeFiles(dir).docs);assert.equal(engine.search('новий каталог бібліотеки',3)[0].url,url);
 const bytes=fs.readFileSync(path.join(dir,'docs.json'),'utf8');await assert.rejects(()=>refreshKnowledge({dataDir:dir,urls:[url],sqlEnabled:false,fetchPage:async()=>{throw Error('offline')}}),/original knowledge/);assert.equal(fs.readFileSync(path.join(dir,'docs.json'),'utf8'),bytes);
});
