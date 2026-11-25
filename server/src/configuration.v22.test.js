import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {persistKnowledge} from './knowledgeStore.js';
test('V22 shared CLI configuration loads cwd dotenv and explicitly selects Kyiv',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-config-'));
 try{fs.writeFileSync(path.join(dir,'.env'),'V22_CONFIG_PROBE=synthetic-only\n');const env={...process.env};delete env.DOTENV_CONFIG_PATH;delete env.V22_CONFIG_PROBE;
 const code=`await import(${JSON.stringify(new URL('./config.js',import.meta.url).href)});console.log(process.env.V22_CONFIG_PROBE,process.env.TZ)`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'synthetic-only Europe/Kyiv');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('V22 corpus guard separately prevents fragment loss and critical-topic loss',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oa-v22-topics-'));
 const doc={id:1,url:'https://www.oa.edu.ua/ua/contacts',title:'Контакти університету',chunk:'Університет надає офіційну контактну інформацію для студентів та вступників. Тут опубліковано електронні адреси й телефони підрозділів для звернень із питань навчання.'};
 try{fs.writeFileSync(path.join(dir,'docs.json'),JSON.stringify(Array.from({length:20},(_,i)=>({...doc,id:i+1}))));assert.throws(()=>persistKnowledge(dir,[doc],{},{backup:false}),/Too few fragments/);
 fs.writeFileSync(path.join(dir,'docs.json'),JSON.stringify([doc]));assert.throws(()=>persistKnowledge(dir,[{...doc,url:'https://www.oa.edu.ua/ua/other'}],{},{backup:false}),/critical knowledge topic/);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'docs.json'),'utf8'))[0].url,doc.url);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
