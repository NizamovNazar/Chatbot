import path from 'node:path';
import fs from 'node:fs';
import '../src/config.js';
import {sqlPrimeKnowledgeFiles,sqlSyncKnowledgeFiles} from '../src/postgresStore.js';
import {atomicJsonWrite} from '../src/storage.js';
import { readKnowledgeFiles,rebuildFromDocuments,persistKnowledge } from '../src/knowledgeStore.js';
const dataDir=path.resolve(process.cwd(),'data');
const apply=process.argv.includes('--apply');
await sqlPrimeKnowledgeFiles(dataDir);
const {docs,meta}=readKnowledgeFiles(dataDir);
if(!docs.length){console.error('No docs.json found; no changes made.');process.exit(1);}
// Idempotent: do not unnecessarily reprocess a v4 corpus; its new content
// has already been cleaned and split semantically.
const allV4=docs.every(x=>x.schemaVersion===4);
const result=allV4?{docs,stats:{version:4,oldChunks:docs.length,newChunks:docs.length,
  oldPages:new Set(docs.map(d=>d.url)).size,newPages:new Set(docs.map(d=>d.url)).size,
  alreadyCurrent:true}}:rebuildFromDocuments(docs);
if(result.stats.newChunks===0 || (result.stats.oldPages>20 && result.stats.newPages<result.stats.oldPages*.55)){
  console.error('Safety threshold failed: old files retained',JSON.stringify(result.stats));process.exit(2);
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',...result.stats},null,2));
if(!apply){console.log('Dry-run only. Execute with --apply to write and back up the database.');process.exit(0);}
if(allV4){console.log('Already on schema v4. No rewriting required.');process.exit(0);}
const saved=persistKnowledge(dataDir,result.docs,{...meta,knowledge_rebuild_stats:result.stats});
const auditFile=path.join(dataDir,'knowledge_audit.json');
atomicJsonWrite(auditFile,{updatedAt:new Date().toISOString(),...result.stats,
 backupLocation:saved.backupDir, documents:saved.documents,pages:saved.pages});
await sqlSyncKnowledgeFiles(dataDir);
console.log(`Knowledge v4 saved: ${saved.documents} chunks, ${saved.pages} pages.`);
console.log(`Backup location: ${saved.backupDir}`);
