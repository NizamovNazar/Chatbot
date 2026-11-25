import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeSearch as before } from '../src/knowledge.v3.baseline.js';
import { createKnowledgeSearch as after } from '../src/knowledge.js';
import { rebuildFromDocuments } from '../src/knowledgeStore.js';
const inputFlag=process.argv.find(x=>x.startsWith('--input='));
const DATA=inputFlag ? path.resolve(inputFlag.slice('--input='.length)) : path.resolve('data/docs.json');
const corpus=JSON.parse(fs.readFileSync(DATA,'utf8'));
// Human-designed retrieval cases: correct target = official page for topic.
// This measures URL retrieval, not truthfulness or generative answer quality.
export const EVAL_CASES = [
 ['Документи для вступу на магістратуру', '/stati-magistrom/dokumenti-ta-stroki-prijomu'],
 ['Яка вартість навчання у магістратурі?', '/stati-magistrom/vartist-navchannya'],
 ['Скільки коштує бакалаврат?', '/stati-bakalavrom/vartist-navchannia'],
 ['Як скласти ЄВІ на магістратуру?', '/stati-magistrom/jevi'],
 ['Коли календар ЄВІ ЄФВВ для магістрів?', '/stati-magistrom/kalendar-provedennya-eviefvv'],
 ['Державне замовлення на магістратуру', '/stati-magistrom/derzhavne-zamovlennya'],
 ['Де контакти приймальної комісії?', '/kontakti'],
 ['Які є спеціальності комп’ютерні науки?', '/specialnosti/kompyuterni-nauki'],
 ['Як поселитися у гуртожиток?', '/umovi-navchannya/gurtozhitki'],
 ['Скільки коштує проживання в гуртожитках?', '/umovi-navchannya/gurtozhitki/vartist-prozhivannya-gurtozhitki'],
 ['Хто ректор університету?', '/ua/info/upravlinya_zvo/rectorsoffice'],
 ['Адреса Острозької академії', '/ua/contacts'],
 ['Бібліотека університету', '/ua/resources/library'],
 ['Історія Острозької академії', '/ua/info/history'],
 ['Міжнародне співробітництво та партнери', '/ua/foreign'],
 ['Вартість навчання в аспірантурі', '/aspirant/vartist-aspirant'],
 ['Розклад вступних випробувань у магістратуру', '/stati-magistrom/rozkladi-vstupnih-viprobuvan'],
 ['Спеціальності аспірантури', '/aspirant/specialnosti'],
 ['Правила прийому на бакалаврат, документи', '/stati-bakalavrom/dokumenti-ta-stroki-prijomu'],
 ['Освітні гранти для студентів', '/osvitni-granty/oa-grants'],
];
function metrics(search){
 const results=EVAL_CASES.map(([query,path])=>{
  const returned=search(query,5);const position=returned.findIndex(d=>d.url.includes(path));
  return {query,expected:path,rank:position<0?null:position+1,top:returned[0]?.url||null,
    firstScore:returned[0]?.relevance||null};
 });
 return {caseCount:results.length,hitAt1:results.filter(d=>d.rank===1).length,
  hitAt5:results.filter(d=>d.rank!==null).length,
  reciprocalRank:Number((results.reduce((n,d)=>n+(d.rank?1/d.rank:0),0)/results.length).toFixed(3)),
  results};
}
const beforeSearch=before(corpus);
const baseline=metrics(beforeSearch.search);
let adjusted=corpus;
if(!corpus.every(d=>d.schemaVersion===4))adjusted=rebuildFromDocuments(corpus).docs;
const newSearch=after(adjusted);
const updated=metrics(newSearch.search);
const report={date:new Date().toISOString(),method:'manual target URLs; retrieval only; does not measure correctness of answers',
  baseline:{count:beforeSearch.count,...baseline},updated:{count:newSearch.count,...updated}};
if(process.argv.includes('--json')) console.log(JSON.stringify(report,null,2));
else{
 console.log(`Legacy search: ${baseline.hitAt1}/${baseline.caseCount} top-1, ${baseline.hitAt5}/${baseline.caseCount} top-5; MRR ${baseline.reciprocalRank}`);
 console.log(`Knowledge v4: ${updated.hitAt1}/${updated.caseCount} top-1, ${updated.hitAt5}/${updated.caseCount} top-5; MRR ${updated.reciprocalRank}`);
 for(let i=0;i<updated.results.length;i++){
  const a=baseline.results[i],b=updated.results[i];
  console.log(`${String(i+1).padStart(2,'0')} before=${String(a.rank||'-').padStart(2)} after=${String(b.rank||'-').padStart(2)} ${b.query}\n    ${b.top}`);
 }
}
if(process.argv.includes('--report')){
 const reportFile=path.resolve('data/knowledge_benchmark.json');
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 console.log('Saved benchmark:',reportFile);
}
