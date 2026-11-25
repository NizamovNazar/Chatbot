import MiniSearch from 'minisearch';
import { tokenize, normalizeTerm, queryTerms } from './quality.js';
import { enrichDoc, pageCategory, studyLevel } from './knowledgeMetadata.js';

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
  const yearWeight = profile.year && doc.year ? (Number(profile.year) === doc.year ? 1.45 : 0.58)
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
 * Hybrid structured lexical retrieval: query morphology + field boosts +
 * hard education-level guards + source metadata + source quality. No network/LLM.
 * Accepts both legacy docs.json and enriched schema v4 records.
 */
export function createKnowledgeSearch(documents = []) {
  const seen = new Set();
  const docs = [];
  for (const item of documents) {
    const d = enrichDoc(item);
    if (!d || d.quality < .28 || d.menuLike) continue;
    const duplicate = d.fingerprint;
    if(seen.has(duplicate)) continue;
    seen.add(duplicate);
    docs.push(d);
  }
  const byId = new Map(docs.map(d=>[d.id,d]));
  const mini = new MiniSearch({fields:['title','chunk','topics'], tokenize, processTerm:normalizeTerm,
    searchOptions: {combineWith:'OR'} });
  mini.addAll(docs.map(d=>({id:d.id,title:d.title,chunk:d.chunk,topics:sourceTopic(d)})));
  function search(question, limit=6) {
    const profile=queryProfile(question);
    if(!profile.terms.length) return [];
    const raw=mini.search(profile.terms.join(' '), { combineWith:'OR',
      boost:{title:3,chunk:1,topics:3.5},
      prefix:term=>term.length>=5, fuzzy:term=>term.length>7?.12:false });
    const evaluated=[];
    for(const result of raw){
      const doc=byId.get(result.id);
      if(!doc || !matchesProfile(doc,profile))continue;
      const {score,coverage}=scoreMatch(doc,result,profile);
      if(coverage < (profile.terms.length<=2? 0.5 : profile.terms.length<=4? .34:.24))continue;
      evaluated.push({doc,score,coverage});
    }
    evaluated.sort((a,b)=>b.score-a.score);
    const out=[], urlHits=new Map(), highest=evaluated[0]?.score||0;
    for(const match of evaluated){
      if(match.score < highest * .2)break;
      const n=urlHits.get(match.doc.url)||0;
      if(n>=2)continue;
      urlHits.set(match.doc.url,n+1);
      // Keep source metadata for transparent answer provenance.
      out.push({...match.doc,relevance:Number(match.score.toFixed(3)),coverage:Number(match.coverage.toFixed(2))});
      if(out.length>=limit)break;
    }
    return out;
  }
  return {search,count:docs.length,totalInput:documents.length};
}
