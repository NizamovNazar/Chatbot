import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanText, chunkText } from './content.js';
import {canonicalUrl,enrichDoc,inspectChunkText,mergeLegacyChunks,getYearMetadata} from './knowledgeMetadata.js';
import {createKnowledgeSearch} from './knowledge.js';
import {rebuildFromDocuments,persistKnowledge,readKnowledgeFiles} from './knowledgeStore.js';

const official='https://vstup.oa.edu.ua';
const sample=(id,url,title,chunk)=>({id,url,title,chunk});

test('HTML removes navigation and repeated containers, preserves real headings, paragraphs, tables',()=>{
 const html=`<html><head><title>Fallback</title><meta property="article:published_time" content="2026-02-19"></head>
  <body><header>HIDDEN</header><nav><p>Many navigation items</p></nav><main>
  <h1>Admission requirements</h1><p>Required documents are listed here.</p>
  <ul><li>Passport and identification.</li><li>Bachelor degree diploma.</li></ul>
  <table><tr><th>Category</th><th>Detail</th></tr><tr><td>Master</td><td>F3</td></tr></table>
  <footer>HIDDEN FOOTER</footer></main></body></html>`;
 const info=cleanText(html);
 assert.equal(info.title,'Admission requirements');
 assert.equal(info.publishedAt,'2026-02-19');
 assert.ok(!info.text.includes('HIDDEN'));
 assert.match(info.text,/Required documents are listed here\.\nPassport and identification\./);
 assert.match(info.text,/Category \| Detail/);
 assert.equal(info.text.match(/Passport and identification/g)?.length,1);
});

test('word boundaries, semantic sentences and idempotent chunks',()=>{
 const input='Section heading\nThis is the first sentence. This is a second sentence.\n'+Array.from({length:100},(_,i)=>`Master level eligibility and examination deadline ${i}.`).join(' ');
 const chunks=chunkText(input,160);
 assert.ok(chunks.length>3);
 assert.ok(chunks.every(c=>c.length<=160));
 assert.match(chunks[0],/Section heading\n/);
 assert.ok(chunks.every(c=>!c.startsWith('ligibility')));
 assert.deepEqual(chunkText(input,160),chunks);
});

test('canonicalises URL, blocks external sites, identifies year and study level',()=>{
 const d=enrichDoc(sample(1,'https://vstup.oa.edu.ua/stati-magistrom/vartist-navchannya/?utm_source=test#top','Вартість навчання | Магістр',
 'Вступна кампанія 2026. Вартість магістратури вказана в матеріалах для вступників.'));
 assert.equal(d.url,official+'/stati-magistrom/vartist-navchannya');
 assert.equal(d.level,'master');
 assert.equal(d.category,'tuition');
 assert.deepEqual(d.years,[2026]);
 assert.equal(d.year,2026);
 assert.equal(enrichDoc(sample(2,'https://evil.oa.edu.ua.attacker.test/vstup','Fake','A complete paragraph with enough words to test the filter.')),null);
 assert.deepEqual(getYearMetadata({url:official+'/stati-magistrom/vartist-navchannya',title:'Вартість',text:'Вступна кампанія 2026\nВступна кампанія 2025'}).years,[2026,2025]);
});

test('legacy overlap reconstructed without slicing words',()=>{
 const docs=[sample(1,official+'/stati-magistrom/jevi','Єдиний вступний іспит (ЄВІ) | Магістр',
 'Навігація\nСпортивні змагання\nЄдиний вступний іспит (ЄВІ)\nМагістр\nЄВІ містить тест загальної компетентності. Результат ск'),
 sample(2,official+'/stati-magistrom/jevi','Єдиний вступний іспит (ЄВІ) | Магістр',
 'Результат складається із двох частин. Це інформація для абітурієнтів.')];
 const merged=mergeLegacyChunks(docs);
 assert.ok(!merged.startsWith('Навігація'));
 assert.match(merged,/ЄВІ містить тест/);
});

test('filters navigation-like excerpts and wrong education level',()=>{
 const noisy='Рейтингові списки. Списки рекомендованих. Накази про зарахування. Студентське життя. Військова кафедра. Братство спудеїв. Панорамний тур.';
 assert.ok(inspectChunkText(noisy).quality<.3);
 const docs=[
  sample(1,official+'/stati-bakalavrom/vartist-navchannia','Вартість навчання | Бакалавр','Вартість навчання для бакалаврів у 2026 році становить визначену суму.'),
  sample(2,official+'/stati-magistrom/vartist-navchannya','Вартість навчання | Магістр','Вартість навчання магістратури у 2026 році визначається освітньою програмою.'),
  sample(3,official+'/stati-magistrom/vartist-navchannya','Вартість навчання | Магістр',noisy),
 ];
 const search=createKnowledgeSearch(docs);
 assert.equal(search.search('Скільки коштує навчання на магістратурі?')[0].level,'master');
 assert.ok(search.search('Вартість навчання для магістрів').every(d=>d.level!=='bachelor'));
 assert.equal(search.count,2);
});

test('offline migration preserves page content and source metadata',()=>{
 const docs=[
  sample(1,official+'/kontakti','Контакти | Абітурієнт НаУОА','Навігація\nПанорамний тур\nКонтакти\nТелефон приймальної комісії вказаний на цій сторінці.'),
  sample(2,official+'/stati-magistrom/jevi','Єдиний вступний іспит (ЄВІ) | Магістр','Єдиний вступний іспит (ЄВІ) Магістр. Докладні умови вступу й правила реєстрації. Іспит складають вступники у магістратуру.'),
 ];
 const result=rebuildFromDocuments(docs);
 assert.equal(result.stats.oldPages,2);
 assert.equal(result.stats.newPages,2);
 assert.ok(result.docs.every(d=>d.schemaVersion===4));
 assert.ok(result.docs.every(d=>d.url.startsWith(official)));
});

test('safe offline write creates a backup and rejects empty corpus',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oa-kb-test-'));
 try {
  fs.writeFileSync(path.join(dir,'docs.json'),JSON.stringify([
   sample(1,official+'/kontakti','Контакти','Приймальна комісія надає інформацію про вступ. Телефон вказано на сторінці.')
  ]));
  const first=readKnowledgeFiles(dir).docs;
  const result=persistKnowledge(dir,first,{last_indexed_count:1});
  assert.ok(fs.existsSync(path.join(dir,'docs_index.json')));
  assert.ok(result.backupDir && fs.existsSync(path.join(result.backupDir,'docs.json')));
  assert.ok(readKnowledgeFiles(dir).docs.every(d=>d.schemaVersion===4));
  assert.throws(()=>persistKnowledge(dir,[]),/empty/i);
  assert.equal(readKnowledgeFiles(dir).docs.length,1);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
