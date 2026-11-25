import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichDoc } from './knowledgeMetadata.js';
import { createKnowledgeSearch } from './knowledge.js';
import { buildSemanticIndex,createSemanticSearch,corpusSignature,loadSemanticIndex,writeSemanticIndex } from './semantic.js';
import { retrievalQuestion,buildExtractiveAnswer } from './quality.js';
import { persistKnowledge,readKnowledgeFiles } from './knowledgeStore.js';

const base='https://vstup.oa.edu.ua';
const d=(id,url,chunk,title='Документи для вступу | Магістр') =>
  enrichDoc({id,url:base+url,title,chunk});
const docUrl='/stati-magistrom/dokumenti-ta-stroki-prijomu';
const documents=[
 d(1,docUrl,'Особи зі спеціальними умовами подають документи, що підтверджують право на пільги. Ця інформація стосується лише спеціальних умов.'),
 d(2,docUrl,'З метою формування особової справи здобувача вищої освіти вступник під час укладення договору про навчання подає документи: | документ, що посвідчує особу (копія); | довідка про реєстрацію місця проживання (копія); | облікова картка платника податків (копія); | військово-обліковий документ (копія); | документ (державного зразка) про раніше здобутий освітній рівень (копія).'),
 d(3,docUrl,'дві кольорові фотокартки розміром 3 х 4 см; | екзаменаційний листок ЄВІ/ЄФВВ та екзаменаційна картка ЄВІ/ЄФВВ; | паперова папка на зав’язках.'),
 d(4,'/stati-magistrom/vartist-navchannya','Вартість навчання залежить від освітньої програми, перелік цін на магістратуру 2026 року публікується окремо.','Вартість навчання | Магістр'),
 d(5,'/stati-bakalavrom/dokumenti-ta-stroki-prijomu','Загальна інформація про вступ до бакалаврату.','Вступ | Бакалавр'),
];

test('stage-two retrieval surfaces the admission DOCUMENT LIST ahead of special-condition documents',()=>{
 const search=createKnowledgeSearch(documents);
 const hits=search.search('Які документи потрібні для вступу на магістратуру?',6);
 assert.equal(hits[0].id,2);
 assert.ok(hits.some(x=>x.id===3));
 assert.ok(hits.every(x=>x.level!=='bachelor'));
});
test('extractive response distinguishes applicant personal file from online application',()=>{
 const search=createKnowledgeSearch(documents);
 const hits=search.search('Які документи потрібні для вступу на магістратуру?',6);
 const answer=buildExtractiveAnswer(hits,'Які документи потрібні для вступу на магістратуру?');
 assert.equal(answer.type,'extractive');
 assert.match(answer.answer,/ПІД ЧАС УКЛАДЕННЯ ДОГОВОРУ/);
 assert.match(answer.answer,/військово-обліковий документ/);
 assert.match(answer.answer,/екзаменаційний листок/);
 assert.equal(answer.sources.length,1);
});
test('short followup retains topic and year without asking for already stated details',()=>{
 const q='Які документи потрібні для вступу на магістратуру у 2026 році?';
 const full=retrievalQuestion('Цікавлять загальні умови',[{role:'user',content:q},{role:'assistant',content:'some reply'}]);
 assert.match(full,/2026/);
 assert.match(full,/магістратуру/);
 assert.match(full,/Уточнення користувача: Цікавлять загальні умови/);
});
test('semantic index builds deterministic local latent embeddings, rejects stale indexes',()=>{
 const more=[...documents,d(6,'/umovi-navchannya/gurtozhitki','Для поселення в студентський гуртожиток потрібно подати заяву. Вільні місця для проживання повідомляє адміністрація.','Гуртожитки'),
 d(7,'/umovi-navchannya/gurtozhitki','Студентське житло та гуртожитки, вартість проживання, поселення студентів.','Гуртожитки'),
 d(8,'/stati-magistrom/jevi','Умови ЄВІ та вступні іспити на магістратуру. Дати проведення ЄВІ у 2026 році.','ЄВІ | Магістр')];
 const unique=more.filter(Boolean);
 const index=buildSemanticIndex(unique,{dimensions:5,iterations:2});
 assert.equal(index.method,'local-randomized-LSA');
 assert.equal(index.corpus,corpusSignature(unique));
 const semantic=createSemanticSearch(index,unique);
 assert.ok(semantic);
 assert.ok(semantic.search('Вступні документи',4).length);
 assert.equal(createSemanticSearch(index,unique.slice(0,-1)),null);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'oa-sem-'));
 try{const file=path.join(folder,'index.json');writeSemanticIndex(file,index);
   assert.equal(loadSemanticIndex(file,unique).reason,'ok');
   assert.equal(loadSemanticIndex(file,unique.slice(1)).reason,'outdated_index');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('hybrid search works with local semantic index and with absent index',()=>{
 const docs=documents.filter(Boolean);
 const index=buildSemanticIndex(docs,{dimensions:3});
 const hybrid=createKnowledgeSearch(docs,{semanticIndex:index});
 assert.equal(hybrid.semanticEnabled,true);
 assert.equal(hybrid.search('Вступні документи магістратура')[0].url,base+docUrl);
 const fallback=createKnowledgeSearch(docs,{semanticIndex:{schema:999}});
 assert.equal(fallback.semanticEnabled,false);
 assert.ok(fallback.search('Вступні документи магістратура').length);
});
test('saving new knowledge also rebuilds the offline semantic index',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'oa-kb5-'));
 const docs=documents.filter(Boolean);
 try{
  fs.writeFileSync(path.join(folder,'docs.json'),JSON.stringify(docs));
  persistKnowledge(folder,docs);
  const after=readKnowledgeFiles(folder).docs;
  assert.equal(loadSemanticIndex(path.join(folder,'semantic_index.json'),after).reason,'ok');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
