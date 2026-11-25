import fs from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { enrichDoc, canonicalUrl, mergeLegacyChunks } from './knowledgeMetadata.js';
import { chunkText } from './content.js';
import { buildSemanticIndex } from './semantic.js';
import {readJsonStrict,atomicJsonWrite} from './storage.js';

function parseJson(file, fallback) {
  return readJsonStrict(file,fallback);
}
export function readKnowledgeFiles(dataDir=path.resolve('data')){
  return {docs:parseJson(path.join(dataDir,'docs.json'),[]),
    meta:parseJson(path.join(dataDir,'docs_meta.json'),{})};
}
export function rebuildFromDocuments(items=[]) {
  const grouped=new Map();
  for(const item of items){
    const u=canonicalUrl(item?.url);
    if(!u || !item?.chunk)continue;
    if(!grouped.has(u))grouped.set(u,[]);
    grouped.get(u).push(item);
  }
  const rebuilt=[], dropped=[], reports=[];
  let lastId=0;
  for(const [url, group] of grouped){
    const oldest=group[0], newest=group.find(d=>d.fetched_at)||oldest;
    const body=mergeLegacyChunks(group);
    const chunks=chunkText(body);
    const before=rebuilt.length;
    for(const chunk of chunks){
      const rich=enrichDoc({id:++lastId,url,title:newest.title||oldest.title,chunk,
        fetched_at:newest.fetched_at||null});
      if(!rich || rich.menuLike || rich.quality<.3)continue;
      rebuilt.push(rich);
    }
    const kept=rebuilt.length-before;
    if(!kept)dropped.push({url, reason:'no substantive text after cleaning'});
    reports.push({url,oldChunks:group.length,newChunks:kept});
  }
  return {docs:rebuilt,stats:{version:4,oldChunks:items.length,newChunks:rebuilt.length,
    oldPages:grouped.size,newPages:reports.filter(r=>r.newChunks).length,
    droppedPages:dropped.length,droppedPageSamples:dropped.slice(0,20),
    totalOriginalCharacters:items.reduce((n,d)=>n+(d.chunk?.length||0),0),
    totalRebuiltCharacters:rebuilt.reduce((n,d)=>n+d.chunk.length,0)}};
}
function safeAtomicWrite(file,body){
  atomicJsonWrite(file,typeof body==='string'?JSON.parse(body):body);
}
export function persistKnowledge(dataDir, docs, meta={}, {backup=true}={}) {
  fs.mkdirSync(dataDir,{recursive:true});
  if(!Array.isArray(docs)||!docs.length)throw new Error('Refusing to replace knowledge base with empty documents');
  const docFile=path.join(dataDir,'docs.json');
  const old=readKnowledgeFiles(dataDir);
  const oldPages=new Set(old.docs.map(d=>canonicalUrl(d.url))).size;
  const safeDocs=[];
  const seen=new Set();
  let id=0;
  for(const d of docs){
    const rich=enrichDoc(d);
    if(!rich || rich.menuLike || rich.quality<.28)continue;
    const key=rich.url+'::'+rich.fingerprint;
    if(seen.has(key))continue;
    seen.add(key);
    safeDocs.push({...rich,id:++id});
  }
  if(!safeDocs.length)throw new Error('Knowledge corpus empty after validation');
  const newPages=new Set(safeDocs.map(d=>d.url)).size;
  if(oldPages>=20&&newPages<Math.ceil(oldPages*.55))throw new Error(`Too few pages after validation (${newPages} of ${oldPages}). Original documents kept.`);
  if(old.docs.length>=20&&safeDocs.length<Math.ceil(old.docs.length*.35))throw new Error('Too few fragments after validation. Original documents kept.');
  const important=[/\/ua\/contacts\/?$/, /\/kontakti\/?$/, /stati-magistrom\/dokumenti/, /stati-bakalavrom\/dokumenti/];
  for(const topic of important)if(old.docs.some(d=>topic.test(d.url||''))&&!safeDocs.some(d=>topic.test(d.url||'')))throw new Error('A critical knowledge topic disappeared. Original documents kept.');
  // createKnowledgeSearch() collapses globally duplicated fragments. The
  // semantic index must use exactly the same document set and IDs.
  const semanticFingerprints=new Set();
  const semanticDocs=safeDocs.filter(d=>!semanticFingerprints.has(d.fingerprint) && semanticFingerprints.add(d.fingerprint));
  const semanticIndex=semanticDocs.length>=5 ? buildSemanticIndex(semanticDocs) : null;
  // Generate a compatible legacy index for tools that consume docs_index.json.
  const index=new MiniSearch({fields:['chunk','title','url'],storeFields:['chunk','title','url'],searchOptions:{prefix:true}});
  index.addAll(safeDocs);
  let backupDir=null;
  if(backup){
    const stamp=new Date().toISOString().replace(/[.:]/g,'-');
    backupDir=path.join(dataDir,'backups',`knowledge-${stamp}`);
    fs.mkdirSync(backupDir,{recursive:true});
    for(const name of ['docs.json','docs_index.json','docs_meta.json','semantic_index.json']){
      const file=path.join(dataDir,name);
      if(fs.existsSync(file))fs.copyFileSync(file,path.join(backupDir,name));
    }
  }
  const files=['docs.json','docs_index.json','docs_meta.json','semantic_index.json'];
  try {
    safeAtomicWrite(docFile,safeDocs);
    safeAtomicWrite(path.join(dataDir,'docs_index.json'),index.toJSON());
    safeAtomicWrite(path.join(dataDir,'docs_meta.json'),{
      ...old.meta,...meta,knowledge_schema:4,knowledge_migrated_at:new Date().toISOString(),
      knowledge_document_count:safeDocs.length,knowledge_page_count:new Set(safeDocs.map(d=>d.url)).size,
      semantic_index_schema:semanticIndex?.schema || null,
    });
    safeAtomicWrite(path.join(dataDir,'semantic_index.json'),semanticIndex);
  } catch (error) {
    // If one write fails, restore ALL three files, rather than leaving an
    // inconsistent docs/index/meta combination.
    if (backupDir) for (const name of files) {
      const original=path.join(backupDir,name), target=path.join(dataDir,name);
      if(fs.existsSync(original))fs.copyFileSync(original,target);
      else if(fs.existsSync(target))fs.unlinkSync(target);
      try{fs.unlinkSync(`${target}.kbv4.tmp`);}catch{}
    }
    throw error;
  }
  return {docs:safeDocs,backupDir,documents:safeDocs.length,pages:new Set(safeDocs.map(d=>d.url)).size};
}
