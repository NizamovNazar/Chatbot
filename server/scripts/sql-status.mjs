import '../src/config.js';
import path from 'node:path';
import { PostgresStore } from '../src/postgresStore.js';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to server/.env'); process.exit(2);
}
let store;
try {
  const opened=await PostgresStore.open(path.resolve('data'));
  store=opened.store;
  const counts=await store.stats();
  const state=await store.load();
  console.log(JSON.stringify({ok:true,backend:'postgresql',importedThisRun:store.imported,
    ...counts,semanticIndexActive:Boolean(state.semanticIndex?.schema),
    settingsPreserved:Boolean(state.faq?.schedule),modelsEvents:state.faq?.model?.events?.length||0},null,2));
} catch(error){ console.error('PostgreSQL check FAILED:',error.message);process.exitCode=1; }
finally{if(store)await store.close().catch(()=>{});}
