/** Reproducible URL-retrieval benchmark against the exactly supplied v4 search. */
import fs from 'node:fs';
import path from 'node:path';
import {createKnowledgeSearch as v4} from '../src/knowledge.v4.baseline.js';
import {createKnowledgeSearch as v5} from '../src/knowledge.js';
import {enrichDoc} from '../src/knowledgeMetadata.js';
import {loadSemanticIndex} from '../src/semantic.js';
import {buildExtractiveAnswer} from '../src/quality.js';
const root=path.resolve('data');
const docs=JSON.parse(fs.readFileSync(path.join(root,'docs.json'),'utf8'));
const semantic=fs.existsSync(path.join(root,'semantic_index.json')) ? JSON.parse(fs.readFileSync(path.join(root,'semantic_index.json'),'utf8')) : null;
const evalCases=[
 ['Документи для вступу на магістратуру','/stati-magistrom/dokumenti-ta-stroki-prijomu'],
 ['Яка вартість навчання у магістратурі?','/stati-magistrom/vartist-navchannya'],
 ['Скільки коштує бакалаврат?','/stati-bakalavrom/vartist-navchannia'],
 ['Як скласти ЄВІ на магістратуру?','/stati-magistrom/jevi'],
 ['Коли календар ЄВІ ЄФВВ для магістрів?','/stati-magistrom/kalendar-provedennya-eviefvv'],
 ['Державне замовлення на магістратуру','/stati-magistrom/derzhavne-zamovlennya'],
 ['Де контакти приймальної комісії?','/kontakti'],
 ['Які є спеціальності комп’ютерні науки?','/specialnosti/kompyuterni-nauki'],
 ['Як поселитися у гуртожиток?','/umovi-navchannya/gurtozhitki'],
 ['Скільки коштує проживання в гуртожитках?','/umovi-navchannya/gurtozhitki/vartist-prozhivannya-gurtozhitki'],
 ['Хто ректор університету?','/ua/info/upravlinya_zvo/rectorsoffice'],
 ['Адреса Острозької академії','/ua/contacts'],
 ['Бібліотека університету','/ua/resources/library'],
 ['Історія Острозької академії','/ua/info/history'],
 ['Міжнародне співробітництво та партнери','/ua/foreign'],
 ['Вартість навчання в аспірантурі','/aspirant/vartist-aspirant'],
 ['Розклад вступних випробувань у магістратуру','/stati-magistrom/rozkladi-vstupnih-viprobuvan'],
 ['Спеціальності аспірантури','/aspirant/specialnosti'],
 ['Правила прийому на бакалаврат, документи','/stati-bakalavrom/dokumenti-ta-stroki-prijomu'],
 ['Освітні гранти для студентів','/osvitni-granty/oa-grants'],
];
const older=v4(docs),modern=v5(docs,{semanticIndex:semantic});
const lexical=v5(docs);
function metrics(engine){
 const rows=evalCases.map(([q,target])=>{
  const output=engine.search(q,10), distinct=[...new Set(output.map(d=>d.url))];
  const rank=distinct.findIndex(url=>url.includes(target))+1;
  return {question:q,rank:rank||null,first:distinct[0]||null};
 });
 return {hitAt1:rows.filter(x=>x.rank===1).length,hitAt5:rows.filter(x=>x.rank && x.rank<=5).length,
  MRR:Math.round(rows.reduce((v,x)=>v+(x.rank?1/x.rank:0),0)/rows.length*1000)/1000,rows};
}
const q='Які документи потрібні для вступу на магістратуру в Острозьку академію у 2026 році?';
const oldDocs=older.search(q,6),newDocs=modern.search(q,6);
const updatedAnswer=buildExtractiveAnswer(newDocs,q);
const result={method:'retrieval-only; 20 hand-picked official URL targets; NOT accuracy of generated answers',
 corpusFragments:docs.length,semanticEnabled:modern.semanticEnabled,
 oldV4:metrics(older),newV5Lexical:metrics(lexical),newV5Hybrid:metrics(modern),
 specificCase:{question:q,oldChunkIds:oldDocs.map(d=>d.id),newChunkIds:newDocs.map(d=>d.id),
  originalListWasFirst:oldDocs[0]?.chunk?.includes('З метою формування особової справи')||false,
  updatedListIsFirst:newDocs[0]?.chunk?.includes('З метою формування особової справи')||false,
  listResponseItems:(updatedAnswer.answer.match(/^-/gm)||[]).length,
  answer:updatedAnswer.answer,source:newDocs[0]?.url||null}};
const report=path.join(root,'hybrid_benchmark.json');
fs.writeFileSync(report,JSON.stringify(result,null,2));
console.log(`v4: ${result.oldV4.hitAt1}/20 Hit@1; ${result.oldV4.hitAt5}/20 Hit@5; MRR ${result.oldV4.MRR}`);
console.log(`v5 lexical: ${result.newV5Lexical.hitAt1}/20 Hit@1; ${result.newV5Lexical.hitAt5}/20 Hit@5; MRR ${result.newV5Lexical.MRR}`);
console.log(`v5 hybrid: ${result.newV5Hybrid.hitAt1}/20 Hit@1; ${result.newV5Hybrid.hitAt5}/20 Hit@5; MRR ${result.newV5Hybrid.MRR}; semantic active ${modern.semanticEnabled}`);
console.log(`Document-list retrieval: before ${result.specificCase.originalListWasFirst}; after ${result.specificCase.updatedListIsFirst}, items ${result.specificCase.listResponseItems}`);
for(let i=0;i<evalCases.length;i++){
 const a=result.oldV4.rows[i],b=result.newV5Hybrid.rows[i];
 if((a.rank||99)!==(b.rank||99))console.log(`${i+1}: ${b.question}: old ${a.rank||'-'}, new ${b.rank||'-'}`);
}
console.log('Saved:',report);
