import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PostgresStore,__v13TestOnly,isPostgresEnabled,readSeedJson} from './postgresStore.js';

test('v13 detects SQL mode only with DATABASE_URL', () => {
  assert.equal(isPostgresEnabled({}), false);
  assert.equal(isPostgresEnabled({DATABASE_URL:''}), false);
  assert.equal(isPostgresEnabled({DATABASE_URL:'postgresql://user:password@localhost/db'}), true);
});
test('v13 seed loader reads all legacy collections, without inventing records', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'oa-pg-seed-'));
  try {
    fs.writeFileSync(path.join(root,'docs.json'),JSON.stringify([{id:1,url:'https://test.invalid',chunk:'text'}]));
    fs.writeFileSync(path.join(root,'faq.json'),JSON.stringify({qas:[{id:1,question:'Питання',answer:'Відповідь'}],chats:[],feedback:[]}));
    const {docs,faq,reports}=__v13TestOnly.snapshotFromFiles(root);
    assert.equal(docs.length,1);assert.equal(faq.qas.length,1);
    assert.deepEqual(faq.quickByLang,{uk:[],en:[]});assert.deepEqual(reports,{weekly:[],monthly:[]});
    assert.throws(()=>__v13TestOnly.safeRows([{id:1},{id:1}]),/Duplicate/);
    fs.writeFileSync(path.join(root,'faq.json'),'{invalid');
    assert.throws(()=>readSeedJson(root,'faq.json',{}),/Invalid import JSON/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('v13 database writes incremental FAQ/chat/feedback with transaction and survives retry',async()=>{
  const recorded=[];let failOnce=false;
  const client={
    query: async(sql, params=[])=>{
      recorded.push([sql,params]);
      if(failOnce && String(sql).includes('oa_chat_entries')){failOnce=false;throw new Error('temporary outage');}
      return {rows:[]};
    },release(){}
  };
  const pool={connect:async()=>client};
  const store=new PostgresStore(pool,'/unused');
  const initial={qas:[],chats:[],feedback:[],quick:[],quickByLang:{uk:[],en:[]},model:{calls:[]},schedule:{hour:2,minute:0}};
  store.baselineFaq=structuredClone(initial);
  const next=structuredClone(initial);
  next.qas=[{id:1,question:'Контакти?',answer:'На сайті',enabled:1,lang:'uk'}];
  next.chats=[{id:'chat1',question:'Контакти?',answer:'На сайті',created_at:'2026-11-23T00:00:00Z'}];
  next.feedback=[{id:'fb1',responseId:'chat1',value:'up',status:'pending'}];
  failOnce=true;
  await assert.rejects(()=>store.saveFaq(next),/temporary outage/);
  assert.equal(store.baselineFaq.chats.length,0,'failed transaction must not advance baseline');
  await store.saveFaq(next);
  assert.equal(store.baselineFaq.chats.length,1);
  const q=recorded.map(row=>row[0]);
  assert.ok(q.includes('ROLLBACK'));assert.ok(q.includes('COMMIT'));
  assert.ok(q.some(sql=>String(sql).includes('oa_faq_entries')));
  assert.ok(q.some(sql=>String(sql).includes('oa_chat_entries')));
  assert.ok(q.some(sql=>String(sql).includes('oa_feedback_entries')));
  const prior=recorded.length;
  await store.saveFaq(next);
  assert.equal(recorded.length,prior+2,'unchanged state needs only BEGIN/COMMIT, no entity rewrites');
  const reset={...next,chats:[],feedback:[]};
  await store.saveFaq(reset);
  assert.ok(recorded.some(row=>row[0]==='DELETE FROM oa_chat_entries WHERE id = ANY($1::text[])'));
});
test('v13 reports keep periods and type without altering public chat',async()=>{
  const queries=[];const pool={connect:async()=>({query:async(sql,args)=>{queries.push({sql,args});return{rows:[]};},release(){}})};
  const store=new PostgresStore(pool,'/unused');store.baselineReports={weekly:[],monthly:[]};
  await store.saveReports({weekly:[{id:'w1',periodStart:'2026-11-16'}],monthly:[{id:'m1',periodStart:'2026-11-01'}]});
  const insert=queries.find(x=>String(x.sql).includes('INSERT INTO oa_reports'));
  assert.ok(insert);
  const entries=JSON.parse(insert.args[0]);
  assert.deepEqual(entries.map(x=>x.__report_type),['weekly','monthly']);
});
