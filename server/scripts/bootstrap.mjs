import '../src/config.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PostgresStore} from '../src/postgresStore.js';
import {persistKnowledge} from '../src/knowledgeStore.js';

if(!process.argv.includes('--confirm-empty-database'))throw new Error('Explicit confirmation required: --confirm-empty-database. This command initializes only a new empty database, with public knowledge and NO private journals.');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required. Use a dedicated demo/test database.');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'oa-public-bootstrap-'));
const corpus=process.argv.find(a=>a.startsWith('--corpus='))?.slice(9);
if(corpus){const docs=JSON.parse(fs.readFileSync(path.resolve(corpus),'utf8'));persistKnowledge(stage,docs,{bootstrap:'public-v22'},{backup:false});}
else{
 process.env.SITE_URLS||='https://vstup.oa.edu.ua/,https://www.oa.edu.ua/';
 const {crawlSite}=await import('../src/crawl.js');
 await crawlSite({dataDir:stage,syncSql:false});
}
let store;
try{const opened=await PostgresStore.open(stage,process.env,{bootstrap:true});store=opened.store;console.log(JSON.stringify({ok:true,initialized:store.imported,storage:'postgresql',counts:await store.stats(),privateDataImported:false}));}
finally{if(store)await store.close();}
// The public-only staging copy is retained for diagnosis; no user files are removed.
