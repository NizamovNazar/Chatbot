// Refresh key pages and retain the rest of the index. Existing data is never
// replaced on zero successful downloads; previous versions are backed up.
import './config.js';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {safeGetOfficial} from './safeFetch.js';
import { cleanText,chunkText } from './content.js';
import { enrichDoc,canonicalUrl } from './knowledgeMetadata.js';
import { readKnowledgeFiles,persistKnowledge } from './knowledgeStore.js';
import { sqlPrimeKnowledgeFiles, sqlSyncKnowledgeFiles, isPostgresEnabled } from './postgresStore.js';
export const DEFAULT_REFRESH_URLS = [
 'https://www.oa.edu.ua/ua/','https://www.oa.edu.ua/ua/contacts',
 'https://www.oa.edu.ua/ua/info/history','https://www.oa.edu.ua/ua/departments',
 'https://www.oa.edu.ua/ua/info/upravlinya_zvo/rectorsoffice',
 'https://www.oa.edu.ua/ua/resources/library','https://www.oa.edu.ua/ua/foreign',
 'https://vstup.oa.edu.ua/','https://vstup.oa.edu.ua/kontakti',
 'https://vstup.oa.edu.ua/specialnosti',
 'https://vstup.oa.edu.ua/stati-magistrom/dokumenti-ta-stroki-prijomu',
 'https://vstup.oa.edu.ua/stati-bakalavrom/dokumenti-ta-stroki-prijomu',
 'https://vstup.oa.edu.ua/stati-magistrom/vartist-navchannya',
 'https://vstup.oa.edu.ua/stati-bakalavrom/vartist-navchannia',
 'https://www.oa.edu.ua/ua/osvita/ects/info_students',
];
export async function refreshKnowledge({dataDir=path.resolve('data'),urls=DEFAULT_REFRESH_URLS,fetchPage=safeGetOfficial,sqlEnabled=isPostgresEnabled(),prime=sqlPrimeKnowledgeFiles,sync=sqlSyncKnowledgeFiles}={}) {
const DATA=dataDir;
if(sqlEnabled)await prime(DATA);
const {docs:existing,meta}=readKnowledgeFiles(DATA);
const updated=new Map(),failed=[];
for(const url of urls){
 try{
  const response=await fetchPage(url,{timeout:12000});
  const contentType=String(response.headers['content-type']||'').toLowerCase();
  if(!contentType.includes('text/html'))throw new Error('Non-HTML page');
  const page=cleanText(response.data.toString('utf8'));
  if(page.text.length<150)throw new Error('Insufficient page text');
  const fetched_at=new Date().toISOString();
  const docs=chunkText(page.text).map(chunk=>enrichDoc({url,chunk,title:page.title,
    fetched_at,published_at:page.publishedAt||null})).filter(d=>d && !d.menuLike&&d.quality>=.3);
  if(!docs.length)throw new Error('No useful chunks');
  updated.set(canonicalUrl(url),docs);
  console.log(JSON.stringify({url,status:'refreshed',chunks:docs.length}));
 }catch(err){failed.push({url,reason:String(err.message||err).slice(0,130)});
  console.log(JSON.stringify({url,status:'failed',reason:failed.at(-1).reason}));}
}
if(updated.size===0)throw new Error('No updates succeeded; original knowledge data was kept.');
else{
 const merged=existing.filter(d=>!updated.has(canonicalUrl(d.url)));
 for(const values of updated.values())merged.push(...values);
 const saved=persistKnowledge(DATA,merged,{...meta,last_refresh_at:new Date().toISOString(),
   last_refresh_success:updated.size,last_refresh_failed:failed});
 if(sqlEnabled)await sync(DATA);
 return {updated:updated.size,failed:failed.length,documents:saved.documents,pages:saved.pages,backup:saved.backupDir};
}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)refreshKnowledge().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
