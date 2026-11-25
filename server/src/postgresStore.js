/**
 * OA Smart Assistant v13 PostgreSQL persistence.
 * PostgreSQL is authoritative when DATABASE_URL is set. V22 bootstrap imports
 * public knowledge only; JSON is never a silent private-state fallback. The UI and retrieval code retain
 * their current in-memory structures; only durable I/O changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {atomicJsonWrite} from './storage.js';

const SCHEMA_PATH = fileURLToPath(new URL('../sql/001_postgres.sql', import.meta.url));
const DEFAULT_FAQ = { qas:[], chats:[], feedback:[], quick:[], quickByLang:{uk:[],en:[]},
  model:{calls:[],events:[],last_error:null,last_success_at:null,headers:{}},
  schedule:{hour:2,minute:0,lastRunDate:null} };
const DEFAULT_REPORTS = { weekly:[],monthly:[] };
const deepCopy = (data) => JSON.parse(JSON.stringify(data));

export function isPostgresEnabled(env=process.env) {
  return Boolean(String(env.DATABASE_URL || '').trim());
}
export function readSeedJson(dataDir, name, fallback) {
  const file=path.join(dataDir,name);
  if(!fs.existsSync(file)) return deepCopy(fallback);
  let value;
  try { value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
  catch(e){throw new Error(`Invalid import JSON ${file}: ${e.message}`);}
  if(value===null || typeof value!=='object')throw new Error(`Invalid import JSON ${file}: expected object/array`);
  return value;
}
function safeRows(input, prefix='row') {
  const used=new Set();
  return (Array.isArray(input)?input:[]).map((entry,index)=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new Error(`Invalid ${prefix} row at ${index}`);
    const raw=entry.id===undefined||entry.id===null?`${prefix}-legacy-${index}`:String(entry.id);
    if(used.has(raw))throw new Error(`Duplicate ${prefix} id: ${raw}`);
    used.add(raw);
    return {...entry,id: entry.id ?? raw};
  });
}
function faqTables(faq) {
  const ordered=(rows,prefix)=>safeRows(rows,prefix).map((row,i)=>({...row,__position:i}));
  return {
    oa_faq_entries: ordered(faq.qas,'qa'),
    oa_chat_entries: ordered(faq.chats,'chat'),
    oa_feedback_entries: ordered(faq.feedback,'feedback'),
  };
}
function reportRows(reports) {
  return ['weekly','monthly'].flatMap(type => safeRows(reports?.[type],`report-${type}`)
    .map((r,index)=>({...r,__report_type:type,__position:index})));
}
const TABLES = {
  oa_faq_entries: {
    insert:`INSERT INTO oa_faq_entries(id,position,question,answer,language,enabled,payload)
      SELECT r->>'id',(r->>'__position')::integer,COALESCE(r->>'question',''),COALESCE(r->>'answer',''),
      COALESCE(r->>'lang','uk'),lower(COALESCE(r->>'enabled','true')) IN ('1','true','yes'),r - '__position'
      FROM jsonb_array_elements($1::jsonb) r
      WHERE true
      ON CONFLICT(id) DO UPDATE SET position=excluded.position,question=excluded.question,answer=excluded.answer,
        language=excluded.language,enabled=excluded.enabled,payload=excluded.payload,updated_at=now()`
  },
  oa_chat_entries: {
    insert:`INSERT INTO oa_chat_entries(id,position,question,answer,created_at,payload)
      SELECT r->>'id',(r->>'__position')::integer,COALESCE(r->>'question',''),COALESCE(r->>'answer',''),r->>'created_at',r - '__position'
      FROM jsonb_array_elements($1::jsonb) r
      WHERE true
      ON CONFLICT(id) DO UPDATE SET position=excluded.position,question=excluded.question,answer=excluded.answer,
        created_at=excluded.created_at,payload=excluded.payload,updated_at=now()`
  },
  oa_feedback_entries: {
    insert:`INSERT INTO oa_feedback_entries(id,position,response_id,status,value,payload)
      SELECT r->>'id',(r->>'__position')::integer,r->>'responseId',COALESCE(r->>'status','pending'),r->>'value',r - '__position'
      FROM jsonb_array_elements($1::jsonb) r
      WHERE true
      ON CONFLICT(id) DO UPDATE SET position=excluded.position,response_id=excluded.response_id,status=excluded.status,
        value=excluded.value,payload=excluded.payload,updated_at=now()`
  },
  oa_reports: {
    insert:`INSERT INTO oa_reports(id,report_type,position,payload)
      SELECT r->>'id',r->>'__report_type',(r->>'__position')::integer,
        r - '__report_type' - '__position'
      FROM jsonb_array_elements($1::jsonb) r
      WHERE true
      ON CONFLICT(id) DO UPDATE SET report_type=excluded.report_type,position=excluded.position,
        payload=excluded.payload,updated_at=now()`
  }
};
const SETTING_KEYS = ['quick','quickByLang','model','schedule'];

function mapRows(rows){return new Map(rows.map(row=>[String(row.id),JSON.stringify(row)]));}
async function withTransaction(pool,fn){
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
  finally{client.release();}
}
async function putSetting(db,key,value){
  await db.query(`INSERT INTO oa_settings(key,payload) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=now()`,[key,JSON.stringify(value)]);
}
async function putArtifact(db,key,value){
  await db.query(`INSERT INTO oa_knowledge_artifacts(key,payload) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=now()`,[key,JSON.stringify(value)]);
}
async function insertRows(db,table,rows){
  if(rows.length)await db.query(TABLES[table].insert,[JSON.stringify(rows)]);
}
async function replaceRows(db,table,rows){
  // Called only during initial import. A transaction protects against half imports.
  await db.query(`DELETE FROM ${table}`);
  await insertRows(db,table,rows);
}
async function patchRows(db,table,prevRows,nextRows){
  const prev=mapRows(prevRows),next=mapRows(nextRows);
  const removed=[...prev.keys()].filter(id=>!next.has(id));
  const changed=nextRows.filter(row=>prev.get(String(row.id))!==next.get(String(row.id)));
  if(removed.length)await db.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`,[removed]);
  if(changed.length)await insertRows(db,table,changed);
}
async function replaceKnowledge(db,{docs,meta,semanticIndex,sourceRefresh,mockSchedule}){
  await db.query('SELECT pg_advisory_xact_lock(132027)');
  if(!Array.isArray(docs)||!docs.length)throw new Error('Refusing to overwrite SQL knowledge with an empty corpus');
  const prepared=safeRows(docs,'doc');
  if(prepared.some(d=>!Number.isSafeInteger(Number(d.id))||Number(d.id)<=0||typeof d.chunk!=='string'))
    throw new Error('Invalid document ID or chunk');
  // COPY/SQL with a single JSONB parameter: 1900 fragments need one bulk insert.
  await db.query('DELETE FROM oa_knowledge_chunks');
  await db.query(`INSERT INTO oa_knowledge_chunks (id,url,title,chunk,payload)
    SELECT (r->>'id')::bigint,COALESCE(r->>'url',''),COALESCE(r->>'title',''),
      COALESCE(r->>'chunk',''),r FROM jsonb_array_elements($1::jsonb) r`,[JSON.stringify(prepared)]);
  await putArtifact(db,'docs_meta',meta||{});
  await putArtifact(db,'semantic_index',semanticIndex||{});
  await putArtifact(db,'source_refresh',sourceRefresh||{});
  if(mockSchedule)await putSetting(db,'mock_schedule',mockSchedule);
}
function snapshotFromFiles(dataDir){
  const docs=readSeedJson(dataDir,'docs.json',[]);
  const faq=readSeedJson(dataDir,'faq.json',DEFAULT_FAQ);
  const reports=readSeedJson(dataDir,'reports.json',DEFAULT_REPORTS);
  const meta=readSeedJson(dataDir,'docs_meta.json',{});
  const semanticIndex=readSeedJson(dataDir,'semantic_index.json',{});
  const sourceRefresh=readSeedJson(dataDir,'source_refresh.json',{});
  const mockSchedule=readSeedJson(dataDir,'mock_schedule.json',{});
  if(!Array.isArray(docs))throw new Error('docs.json must be an array');
  if(!faq||Array.isArray(faq)||typeof faq!=='object')throw new Error('faq.json must be an object');
  return {docs,faq:{...DEFAULT_FAQ,...faq},reports:{...DEFAULT_REPORTS,...reports},
    meta,semanticIndex,sourceRefresh,mockSchedule};
}
async function migrateInitial(db,dataDir,{bootstrap=false}={}){
  await db.query('SELECT pg_advisory_xact_lock(132026)');
  const status=await db.query(`SELECT payload FROM oa_settings WHERE key='migration_v13_complete' FOR UPDATE`);
  if(status.rows.length)return false;
  if(!bootstrap)throw new Error('DATABASE_NOT_BOOTSTRAPPED: run npm run sql:bootstrap -- --confirm-empty-database. Existing databases are never silently seeded.');
  // Public bootstrap intentionally never reads/imports private FAQ, chats or reports.
  const snapshot={docs:readSeedJson(dataDir,'docs.json',[]),meta:readSeedJson(dataDir,'docs_meta.json',{}),semanticIndex:readSeedJson(dataDir,'semantic_index.json',{}),sourceRefresh:readSeedJson(dataDir,'source_refresh.json',{}),mockSchedule:{},faq:deepCopy(DEFAULT_FAQ),reports:deepCopy(DEFAULT_REPORTS)};
  if(!Array.isArray(snapshot.docs)||!snapshot.docs.length)throw new Error('Bootstrap requires a non-empty public corpus.');
  // Fail closed on preexisting DB with missing migration marker.
  for(const table of ['oa_knowledge_chunks','oa_faq_entries','oa_chat_entries','oa_feedback_entries','oa_reports','oa_settings','oa_knowledge_artifacts']){
    const r=await db.query(`SELECT COUNT(*)::integer AS n FROM ${table}`);
    if(Number(r.rows[0].n)>0)throw new Error(`Existing data in ${table} without migration marker. Aborting import to avoid overwrite.`);
  }
  const {faq,reports}=snapshot;
  for(const [table,rows] of Object.entries(faqTables(faq)))await replaceRows(db,table,rows);
  await replaceRows(db,'oa_reports',reportRows(reports));
  for(const key of SETTING_KEYS)await putSetting(db,key,faq[key]??DEFAULT_FAQ[key]);
  if(snapshot.docs.length){await replaceKnowledge(db,snapshot);}
  else {
    await putArtifact(db,'docs_meta',snapshot.meta);
    await putArtifact(db,'semantic_index',snapshot.semanticIndex);
    await putArtifact(db,'source_refresh',snapshot.sourceRefresh);
    await putSetting(db,'mock_schedule',snapshot.mockSchedule);
  }
  await putSetting(db,'migration_v13_complete',{
    schema:13,imported_at:new Date().toISOString(),docs:snapshot.docs.length,
    faq:(faq.qas||[]).length,chats:(faq.chats||[]).length,feedback:(faq.feedback||[]).length,
  });
  return true;
}
function recordArray(result){return result.rows.map(row=>row.payload);}
async function loadState(db){
  const [qa,chats,feedback,reports,settings,docs,artifacts]=await Promise.all([
    db.query('SELECT payload FROM oa_faq_entries ORDER BY position,id'),
    db.query('SELECT payload FROM oa_chat_entries ORDER BY position,id'),
    db.query('SELECT payload FROM oa_feedback_entries ORDER BY position,id'),
    db.query('SELECT payload,report_type FROM oa_reports ORDER BY report_type,position,id'),
    db.query('SELECT key,payload FROM oa_settings'),
    db.query('SELECT payload FROM oa_knowledge_chunks ORDER BY id'),
    db.query('SELECT key,payload FROM oa_knowledge_artifacts')
  ]);
  const settingsMap=Object.fromEntries(settings.rows.map(r=>[r.key,r.payload]));
  const artifactsMap=Object.fromEntries(artifacts.rows.map(r=>[r.key,r.payload]));
  const reportGroups={weekly:[],monthly:[]};
  for(const row of reports.rows)if(reportGroups[row.report_type])reportGroups[row.report_type].push(row.payload);
  return {
    faq:{...deepCopy(DEFAULT_FAQ),qas:recordArray(qa),chats:recordArray(chats),feedback:recordArray(feedback),
      quick:settingsMap.quick??[],quickByLang:settingsMap.quickByLang??{uk:[],en:[]},
      model:settingsMap.model??deepCopy(DEFAULT_FAQ.model),
      schedule:settingsMap.schedule??deepCopy(DEFAULT_FAQ.schedule)},
    reports:reportGroups,
    docs:recordArray(docs),meta:artifactsMap.docs_meta??{},
    semanticIndex:artifactsMap.semantic_index??{},sourceRefresh:artifactsMap.source_refresh??{},
    mockSchedule:settingsMap.mock_schedule??{}
  };
}
function hashEntry(a){return JSON.stringify(a);}
export class PostgresStore {
  constructor(pool,dataDir){this.pool=pool;this.dataDir=dataDir;this.queue=Promise.resolve();this.baselineFaq=null;this.baselineReports=null;}
  static async open(dataDir,env=process.env,options={}){
    const connectionString=String(env.DATABASE_URL||'').trim();
    if(!connectionString)throw new Error('DATABASE_URL is required for PostgreSQL mode');
    let Pool;
    try { const driver=await import('pg'); Pool=driver.Pool || driver.default?.Pool; }
    catch(e){throw new Error(`PostgreSQL driver pg is not installed: run npm install in server. ${e.message}`);}
    if(!Pool)throw new Error('PostgreSQL driver pg has no Pool export. Reinstall server dependencies.');
    const pool=new Pool({connectionString,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,
      application_name:'OA-Smart-Assistant'});
    const store=new PostgresStore(pool,dataDir);
    try {
      await pool.query('SELECT 1');
      if(options.bootstrap)await pool.query(fs.readFileSync(SCHEMA_PATH,'utf8'));
      else if(!(await pool.query("SELECT to_regclass('oa_settings') AS table_name")).rows[0]?.table_name)
        throw new Error('DATABASE_NOT_BOOTSTRAPPED: run the explicit sql:bootstrap command.');
      store.imported=await withTransaction(pool,client=>migrateInitial(client,dataDir,options));
      const state=await loadState(pool);
      store.baselineFaq=deepCopy(state.faq);store.baselineReports=deepCopy(state.reports);
      return {store,state};
    } catch(error){await pool.end().catch(()=>{});throw error;}
  }
  saveFaq(faq){
    const snapshot=deepCopy(faq);
    const job=async()=>{
      const prev=this.baselineFaq || deepCopy(DEFAULT_FAQ);
      await withTransaction(this.pool,async client=>{
        const prevTables=faqTables(prev),nextTables=faqTables(snapshot);
        for(const table of Object.keys(nextTables))await patchRows(client,table,prevTables[table],nextTables[table]);
        for(const key of SETTING_KEYS)if(hashEntry(prev[key])!==hashEntry(snapshot[key]))
          await putSetting(client,key,snapshot[key]??DEFAULT_FAQ[key]);
      });
      this.baselineFaq=deepCopy(snapshot);
    };
    const next=this.queue.then(job);this.queue=next.catch(()=>{});return next;
  }
  saveReports(reports){
    const snapshot=deepCopy(reports);
    const job=async()=>{
      await withTransaction(this.pool,client=>patchRows(client,'oa_reports',reportRows(this.baselineReports||DEFAULT_REPORTS),reportRows(snapshot)));
      this.baselineReports=deepCopy(snapshot);
    };
    const next=this.queue.then(job);this.queue=next.catch(()=>{});return next;
  }
  async load(){await this.queue;return loadState(this.pool);}
  async knowledgeRevision(){const r=await this.pool.query("SELECT payload FROM oa_knowledge_artifacts WHERE key='docs_meta'");const m=r.rows[0]?.payload||{};return m.knowledge_migrated_at||m.last_refresh_at||m.last_indexed_at||null;}
  async knowledgeState(){const [docs,artifacts]=await Promise.all([this.pool.query('SELECT payload FROM oa_knowledge_chunks ORDER BY id'),this.pool.query('SELECT key,payload FROM oa_knowledge_artifacts')]);const a=Object.fromEntries(artifacts.rows.map(r=>[r.key,r.payload]));return {docs:recordArray(docs),meta:a.docs_meta||{},semanticIndex:a.semantic_index||null,sourceRefresh:a.source_refresh||{}};}
  async updateAuth(change,key='admin_auth_v22'){
    // Independent row lock: shared across processes, without exposing failures in FAQ/status.
    return withTransaction(this.pool,async client=>{
      await client.query("INSERT INTO oa_settings(key,payload) VALUES($1,'{}'::jsonb) ON CONFLICT(key) DO NOTHING",[key]);
      const r=await client.query("SELECT payload FROM oa_settings WHERE key=$1 FOR UPDATE",[key]);
      const draft=deepCopy(r.rows[0]?.payload||{});
      const result=await change(draft);
      await putSetting(client,key,draft);
      return result;
    });
  }
  async replaceKnowledgeFromFiles(){
    const snapshot=snapshotFromFiles(this.dataDir);
    const job=()=>withTransaction(this.pool,client=>replaceKnowledge(client,snapshot));
    const next=this.queue.then(job);this.queue=next.catch(()=>{});await next;
    return snapshot;
  }
  async stats(){
    await this.queue;
    const tables=['oa_knowledge_chunks','oa_faq_entries','oa_chat_entries','oa_feedback_entries','oa_reports'];
    const result={};for(const table of tables){const r=await this.pool.query(`SELECT count(*)::integer AS n FROM ${table}`);result[table]=Number(r.rows[0].n);}
    return result;
  }
  async close(){await this.queue;await this.pool.end();}
}
export async function sqlSyncKnowledgeFiles(dataDir,env=process.env){
  if(!isPostgresEnabled(env))return null;
  const {store}=await PostgresStore.open(dataDir,env);
  try{return await store.replaceKnowledgeFromFiles();}finally{await store.close();}
}
export async function sqlPrimeKnowledgeFiles(dataDir,env=process.env){
  if(!isPostgresEnabled(env))return null;
  const {store,state}=await PostgresStore.open(dataDir,env);
  try {
    fs.mkdirSync(dataDir,{recursive:true});
    for(const [name,value] of Object.entries({
      'docs.json':state.docs,'docs_meta.json':state.meta,
      'semantic_index.json':state.semanticIndex,'source_refresh.json':state.sourceRefresh
    })){
      atomicJsonWrite(path.join(dataDir,name),value);
    }
    return {docs:state.docs.length};
  }finally{await store.close();}
}

// Pure helpers exported for deterministic migration/persistence unit tests.
export const __v13TestOnly = {safeRows, faqTables, reportRows, snapshotFromFiles};
export const __v22TestOnly = {migrateInitial};
