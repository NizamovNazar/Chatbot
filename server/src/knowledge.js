import MiniSearch from 'minisearch';
import { tokenize, normalizeTerm, queryTerms } from './quality.js';
import { enrichDoc, pageCategory } from './knowledgeMetadata.js';
import { createSemanticSearch } from './semantic.js';

const levelWords = { bachelor: 'бакалавр', master: 'магістр', doctoral: 'аспірантура' };
const categoryWords = {
  tuition: 'вартість навчання оплата контракт',
  admission_rules: 'правила вступу документи строки реєстрація заяви',
  admission_exams: 'вступні випробування ЄВІ ЄФВВ іспити',
  admission_results: 'рейтинг зарахування рекомендація',
  contacts: 'контакти адреса телефон',
  dormitory: 'гуртожиток проживання поселення',
  study_programs: 'спеціальності освітня програма',
  leadership: 'ректор ректорат',
  international: 'міжнародний партнер іноземний',
  library: 'бібліотека', history:'історія заснування',
};
function queryProfile(question) {
  const q = String(question || '');
  const terms = queryTerms(q);
  const level = /магістр|master/iu.test(q) && !/бакалавр\p{L}*.*магістр|магістр\p{L}*.*бакалавр/iu.test(q) ? 'master'
    : /бакалавр|bachelor/iu.test(q) && !/магістр|master/iu.test(q) ? 'bachelor'
    : /аспірант|\bphd\b|доктор філософії/iu.test(q) ? 'doctoral' : null;
  const year = q.match(/\b20(?:1\d|2\d|3\d)\b/)?.[0];
  const programme = /комп[’'`ʼ]?ютерн\p{L}* наук|computer\s+science|\bF3\b/iu.test(q) ? 'computer_science' : null;
  let category = pageCategory('',q);
  if (/строк|календар|реєстраці|подач|пода(?:ння|ти)\s+заяв/iu.test(q)) category='admission_rules';
  if (/випробуван|іспит|єві|єфвв|exam/iu.test(q) && !/документ/iu.test(q)) category='admission_exams';
  if (/документ/iu.test(q)) category='admission_rules';
  // Do not reduce one query with several unrelated topics to one category.
  const competing = ['вартіст|кошту|tuition','документ','випробуван|єві|єфвв','гуртожит','контакт'].filter(p=>new RegExp(p,'iu').test(q));
  if (competing.length > 1) category = 'general';
  return { terms, level, year, programme, category, question:q };
}
function sourceTopic(doc) {
  return [categoryWords[doc.category] || '', doc.level ? levelWords[doc.level] : '',
    doc.program === 'computer_science' ? 'комп’ютерні науки F3' : '',
    doc.year ? String(doc.year) : ''].join(' ');
}
function matchesProfile(doc, profile) {
  if(profile.level && doc.level && doc.level !== profile.level) return false;
  // A completely different programme page cannot answer a named programme query.
  if(profile.programme && doc.category === 'study_programs' && /\/specialnosti\//.test(doc.url)
      && doc.program !== profile.programme) return false;
  return true;
}
function scoreMatch(doc, raw, profile) {
  const matches = Object.keys(raw.match || {});
  // MiniSearch match keys are ALREADY normalised by processTerm.
  const hitCount = new Set(matches);
  const coverage = profile.terms.filter(t=>hitCount.has(t)).length / profile.terms.length;
  let categoryWeight = 1;
  if(profile.category !== 'general') {
    categoryWeight = doc.category === profile.category ? 2.4 :
      (doc.category === 'news' || doc.category === 'admission_results' ? 0.32 : 0.78);
  } else if(doc.category === 'news') categoryWeight = .62;
  const levelWeight = profile.level && doc.level === profile.level ? 1.5 : 1;
  const yearWeight = profile.year && doc.year ? (Number(profile.year) === doc.year ? 1.45 : 0.20)
    : profile.year && doc.years?.length && doc.years.includes(Number(profile.year)) ? 1.25 : 1;
  const programmeWeight = profile.programme && doc.program === profile.programme ? 1.5 : 1;
  const thisYear=new Date().getUTCFullYear();
  // Without a requested year, prioritize recent admissions rules. Historic
  // rules remain available when a historical year is explicitly requested.
  const freshnessWeight = !profile.year && doc.year &&
    ['tuition','admission_rules','admission_exams','admission_results'].includes(doc.category)
    ? (doc.year < thisYear-4 ? .17 : doc.year < thisYear-2 ? .45 : 1.18) : 1;

  const qualityWeight = Math.max(.12, Math.min(1, Number(doc.quality) || .5));
  // Prioritize the dedicated, official page over a mention in a generic list.
  const u=doc.url;
  let canonicalWeight=1;
  if(profile.category==='history' && /\/ua\/info\/history(?:$|[/?])/.test(u)) canonicalWeight=2.2;
  if(profile.category==='international' && /\/ua\/foreign(?:$|[/?])/.test(u)) canonicalWeight=2.1;
  if(profile.category==='contacts' && /(?:приймальн|вступ|абітурієнт)/iu.test(profile.question)
      && /vstup\.oa\.edu\.ua\/kontakti/.test(u)) canonicalWeight=2.3;
  if(profile.level==='doctoral' && profile.category==='study_programs'
      && /\/aspirant\/specialnosti/.test(u)) canonicalWeight=2;
  if(profile.category==='admission_exams' && /\/stati-magistrom\/jevi$/.test(u)
      && /єві|єдиний вступний/iu.test(profile.question) && !/календар|строк|сесію/iu.test(profile.question)) canonicalWeight=2;

  const score = raw.score * (0.3 + 2.0 * coverage ** 2) * categoryWeight * levelWeight
    * yearWeight * programmeWeight * qualityWeight * canonicalWeight * freshnessWeight;
  return { score, coverage };
}
/**
 * Two-stage evidence retrieval:
 *  1. Rank WHOLE pages using the lexical engine (and optional LSA vectors).
 *  2. Inspect ALL chunks of the top pages to find actual answer-bearing
 *     paragraphs, not just whichever two happened to match a few words first.
 * The hard guards for education level/programme apply to BOTH stages.
 */
function chunkEvidence(doc, profile) {
  const chunkTerms = new Set(queryTerms(doc.chunk || ''));
  const query = profile.terms.filter(t => !/^20\d{2}$/.test(t));
  const coverage = query.length ? query.filter(t => chunkTerms.has(t)).length / query.length : 0;
  let bonus = 0;
  const text = doc.chunk || '';
  if (profile.category === 'admission_rules' && /документ|documents?/iu.test(profile.question)) {
    const items = [
      /документ.{0,35}посвідчує особу/iu, /реєстраці.{0,25}місця проживання/iu,
      /обліков.{0,40}платника податків/iu, /військово-обліков/iu,
      /раніше здобуто.{0,30}освіт/iu, /фотокарт/iu,
      /екзаменаційн.{0,15}листок/iu, /паперова папка/iu,
      /особової справи/iu, /особист.{0,15}електронн.{0,15}кабінет/iu,
    ].filter(p => p.test(text)).length;
    bonus += Math.min(17,items*2.6);
    if (/спеціальн.{0,25}умов/iu.test(text) && items < 2)bonus -= 7;
    if (/Переведення на вакантні місця/iu.test(text))bonus -= 8;
    if (/Правила прийому 2017/i.test(doc.title))bonus -= 15;
  }
  if (profile.category === 'tuition') {
    if (/грн|вартість.+(?:рік|семестр)|плата за навчання/iu.test(text))bonus+=4;
    if(/бакалавр/iu.test(text) && profile.level === 'master')bonus-=8;
  }
  if (profile.category === 'admission_exams' && /ЄВІ|ЄФВВ|вступн.{0,15}іспит/iu.test(text))bonus+=4;
  if (profile.category === 'dormitory' && /поселен|заселен|гуртожиток/iu.test(text))bonus+=3;
  if (profile.year && doc.year && Number(profile.year) !== doc.year)bonus-=12;
  if (profile.year && doc.years?.includes(Number(profile.year)))bonus+=2;
  if (/(?:документ|перелік|список|які потрібно|що подати)/iu.test(profile.question)
    && /(?:перелік|подає до|подають|необхідні документи|документи:)/iu.test(text))bonus+=2;
  return {score:12*coverage+bonus,coverage};
}

export function createKnowledgeSearch(documents = [], {semanticIndex=null}={}) {
  const seen = new Set(), docs=[];
  for (const item of documents) {
    const d = enrichDoc(item);
    if (!d || d.quality < .28 || d.menuLike) continue;
    if(seen.has(d.fingerprint))continue;
    seen.add(d.fingerprint);
    docs.push(d);
  }
  const byId=new Map(docs.map(d=>[d.id,d]));
  const byUrl=new Map();
  for(const d of docs){if(!byUrl.has(d.url))byUrl.set(d.url,[]);byUrl.get(d.url).push(d);}
  for (const chunks of byUrl.values())chunks.sort((a,b)=>Number(a.id)-Number(b.id));
  const mini=new MiniSearch({fields:['title','chunk','topics'], tokenize, processTerm:normalizeTerm,
    searchOptions:{combineWith:'OR'}});
  mini.addAll(docs.map(d=>({id:d.id,title:d.title,chunk:d.chunk,topics:sourceTopic(d)})));
  const semantic=semanticIndex ? createSemanticSearch(semanticIndex,docs) : null;
  function search(question,limit=6){
    const profile=queryProfile(question);
    if(!profile.terms.length)return [];
    const raw=mini.search(profile.terms.join(' '),{
      combineWith:'OR',boost:{title:3,chunk:1,topics:3.5},
      prefix:term=>term.length>=5,fuzzy:term=>term.length>7?.12:false
    });
    const lexicalPages=new Map();
    for(const result of raw){
      const d=byId.get(result.id);
      if(!d || !matchesProfile(d,profile))continue;
      const {score,coverage}=scoreMatch(d,result,profile);
      if(coverage < (profile.terms.length<=2?.5:profile.terms.length<=4?.34:.24))continue;
      const best=lexicalPages.get(d.url);
      if(!best || score>best.score)lexicalPages.set(d.url,{score,doc:d});
    }
    const rankedLexical=[...lexicalPages].sort((a,b)=>b[1].score-a[1].score);
    const pages=new Map();
    const lexicalMax=rankedLexical[0]?.[1].score || 1;
    rankedLexical.slice(0,35).forEach(([url,item],rank)=>{
      pages.set(url,{url,lexical:Math.log1p(item.score)/Math.log1p(lexicalMax),
        semantic:0,lexicalRank:rank+1});
    });
    if(semantic){
      const semanticResults=semantic.search(question,Math.min(docs.length,250));
      const topScore=semanticResults[0]?.score||1;
      for(let i=0;i<semanticResults.length;i++){
        const hit=semanticResults[i],d=byId.get(hit.id);
        if(!d || !matchesProfile(d,profile))continue;
        // The neural/LSA signal can nominate pages, but it cannot override
        // metadata compatibility or promote very weak similarities.
        if(hit.score < Math.max(.15,topScore*.54))continue;
        const p=pages.get(d.url)||{url:d.url,lexical:0,semantic:0,lexicalRank:999};
        p.semantic=Math.max(p.semantic,hit.score);
        pages.set(d.url,p);
      }
    }
    const maxSemantic=Math.max(.000001,...[...pages.values()].map(p=>p.semantic));
    // Semantic rank may rescue a weak lexical search, but should not
    // overthrow a strong title/topic match merely due to general similarity.
    const semanticWeight = Math.max(.055,.32-.265*Math.min(1,lexicalMax/220));
    const pageRanks=[...pages.values()].map(p=>({
      ...p,score:p.lexical*(1-semanticWeight)+(p.semantic? p.semantic/maxSemantic*semanticWeight:0)
    })).sort((a,b)=>b.score-a.score);
    const candidates=[];
    for (const page of pageRanks.slice(0,14)) {
      const chunks=byUrl.get(page.url)||[];
      for(const d of chunks){
        if(!matchesProfile(d,profile))continue;
        const evidence=chunkEvidence(d,profile);
        // A chunk containing useful lists can beat a generic top-lexical
        // snippet from the same page (or a related page).
        const score=page.score*19+evidence.score+d.quality*2;
        candidates.push({doc:d,score,pageScore:page.score,evidence});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    const out=[],pageCounts=new Map();
    const topScore=candidates[0]?.score||0;
    const isDocuments=profile.category==='admission_rules'&&/документ/iu.test(question);
    const perPage=isDocuments?4:2;
    for(const candidate of candidates){
      if(out.length>=limit)break;
      if(candidate.score<topScore*.43)continue;
      // require at least a credible page match, or an explicitly relevant
      // paragraph; a semantically related but ungrounded page is not enough.
      if(candidate.pageScore<.35 && candidate.evidence.coverage<.3)continue;
      const n=pageCounts.get(candidate.doc.url)||0;
      if(n>=perPage)continue;
      const pageYears=[...new Set((byUrl.get(candidate.doc.url)||[])
        .flatMap(x=>[...(x.years||[]),...((x.chunk||'').match(/\b20\d{2}\b/g)||[])])
        .map(Number).filter(Number.isFinite))].sort((a,b)=>b-a);
      out.push({...candidate.doc,pageYears,relevance:roundScore(candidate.score),
        coverage:roundScore(candidate.evidence.coverage),searchMethod:semantic?'hybrid_lsa_lexical':'lexical_page_chunk'});
      pageCounts.set(candidate.doc.url,n+1);
    }
    // If there is a multi-item document list split between adjacent chunks,
    // preserve its continuation instead of cutting the list at a chunk border.
    if(isDocuments && out.length<limit){
      const list=out.find(d=>/З метою формування особової справи/iu.test(d.chunk));
      if(list){
        const siblings=byUrl.get(list.url)||[];
        const index=siblings.findIndex(x=>x.id===list.id),next=siblings[index+1];
        if(next && /(?:фотокарт|ЄВІ|ЄФВВ|паперова папка)/iu.test(next.chunk)
          && !out.some(x=>x.id===next.id))out.push({...next,pageYears:list.pageYears,relevance:roundScore(out[0].relevance*.8),
            coverage:.4,searchMethod:semantic?'hybrid_lsa_lexical':'lexical_page_chunk'});
      }
    }
    return out.slice(0,limit);
  }
  return {search,count:docs.length,totalInput:documents.length,semanticEnabled:Boolean(semantic),
    semanticMethod:semantic?.method||null};
}
function roundScore(x){return Math.round(x*1000)/1000;}
