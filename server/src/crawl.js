import fs from 'node:fs';
import path from 'node:path';
import './config.js';
import {safeGetOfficial} from './safeFetch.js';
import * as cheerio from 'cheerio';
import { pathToFileURL } from 'node:url';
import { cleanText, chunkText } from './content.js';
import { canonicalUrl, enrichDoc } from './knowledgeMetadata.js';
import { readKnowledgeFiles, persistKnowledge } from './knowledgeStore.js';
import { sqlPrimeKnowledgeFiles, sqlSyncKnowledgeFiles, isPostgresEnabled } from './postgresStore.js';

const DATA_DIR=path.resolve('data');
const SITE_URLS=(process.env.SITE_URLS||'').split(',').map(x=>canonicalUrl(x.trim())).filter(Boolean);
const MAX_PAGES=Math.max(1,Math.min(1000,Number(process.env.CRAWL_MAX_PAGES)||300));
const MAX_DEPTH=Math.max(0,Math.min(7,Number(process.env.CRAWL_MAX_DEPTH)||3));
const seeds=SITE_URLS.map(s=>new URL(s));
function isAllowed(raw) {
  try {
    const url=new URL(raw);
    return seeds.some(s=>url.origin===s.origin &&
      (s.pathname==='/' || url.pathname===s.pathname || url.pathname.startsWith(s.pathname.replace(/\/$/,'')+'/')));
  }catch{return false;}
}
function extractLinks($,baseUrl){
  const links=new Set();
  $('a[href]').each((_,el)=>{
    const href=$(el).attr('href');
    if(!href || /^(?:mailto:|tel:|javascript:)/i.test(href))return;
    try{
      const url=canonicalUrl(new URL(href,baseUrl).toString());
      if(isAllowed(url) && !/\.(pdf|docx?|xlsx?|zip|jpg|png|webp|svg|mp4|mp3)(?:\?|$)/i.test(url))links.add(url);
    }catch{}
  });
  return [...links];
}
async function fetchPage(url){
  const r=await safeGetOfficial(url);
  const contentType=(r.headers['content-type']||'').toLowerCase();
  if(!/text\/html|text\/plain/.test(contentType))return null;
  return r.data.toString('utf8');
}
export async function crawlSite(options={}){
  const {onProgress}=options;
  const dataDir=options.dataDir||DATA_DIR;
  const syncSql=options.syncSql!==false&&isPostgresEnabled();
  if(!SITE_URLS.length){console.log('SITE_URLS is empty. Set it in .env.');return null;}
  if(syncSql) await sqlPrimeKnowledgeFiles(dataDir);
  const start=Date.now();
  const queue=SITE_URLS.map(url=>({url,depth:0}));
  const pending=new Set(SITE_URLS),seen=new Set(),byPage=new Map(),errors=[];
  onProgress?.({status:'running',indexed:0,seen:0,queued:queue.length});
  while(queue.length && byPage.size<MAX_PAGES){
    const {url,depth}=queue.shift(); pending.delete(url);
    if(seen.has(url))continue;seen.add(url);
    try{
      const html=await fetchPage(url);
      if(!html)continue;
      const parsed=cleanText(html);
      const chunks=chunkText(parsed.text);
      if(chunks.length && parsed.text.length>=150){
        const fetched_at=new Date().toISOString();
        const docs=chunks.map(chunk=>enrichDoc({url,title:parsed.title,chunk,fetched_at,
          published_at:parsed.publishedAt||null})).filter(d=>d && !d.menuLike && d.quality>=.3);
        if(docs.length)byPage.set(url,docs);
        onProgress?.({status:'running',indexed:byPage.size,seen:seen.size,queued:queue.length});
      }
      if(depth<MAX_DEPTH){
        const $=cheerio.load(html);
        for(const link of extractLinks($,url))if(!seen.has(link)&&!pending.has(link)){
          pending.add(link);queue.push({url:link,depth:depth+1});
        }
      }
    }catch(error){errors.push({url,message:String(error.message||error).slice(0,180)});}
  }
  if(!byPage.size)throw new Error('No pages indexed. Existing knowledge files were not modified.');
  const {docs:old,meta}=readKnowledgeFiles(dataDir);
  const merged=new Map();
  for(const doc of old){
    const key=canonicalUrl(doc.url);
    if(!key || byPage.has(key))continue;
    if(!merged.has(key))merged.set(key,[]);
    merged.get(key).push(doc);
  }
  for(const [url,docs] of byPage)merged.set(url,docs);
  const result=persistKnowledge(dataDir,[...merged.values()].flat(),{
    ...meta,last_indexed_at:new Date().toISOString(),last_indexed_count:byPage.size,
    prev_indexed_count:Number(meta.last_indexed_count||0),
    last_index_duration_ms:Date.now()-start,
    last_index_errors:errors.slice(0,50),
  });
  if(syncSql)await sqlSyncKnowledgeFiles(dataDir);
  onProgress?.({status:'idle',indexed:byPage.size,seen:seen.size,queued:0,finishedAt:new Date().toISOString()});
  console.log(`Crawl complete: updated ${byPage.size} pages; retained unchanged pages; total ${result.pages}; backup ${result.backupDir}`);
  return {updated:byPage.size,totalPages:result.pages,documents:result.documents,errors};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  crawlSite().catch(err=>{console.error(err);process.exitCode=1;});
}
