import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {once} from 'node:events';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port = s.address().port;
  await new Promise((resolve,reject)=>s.close(err=>err?reject(err):resolve()));
  return port;
}

 test('compiled site and API share an origin without exposing admin data', async () => {
   const temp = fs.mkdtempSync(path.join(os.tmpdir(),'oa-v14-site-'));
   const port = await freePort();
   const marker = `oa-v14-${process.pid}`;
   fs.writeFileSync(path.join(temp,'index.html'),`<!DOCTYPE html><title>${marker}</title>`);
   fs.writeFileSync(path.join(temp,'admin.html'),'<!DOCTYPE html><title>OA Admin</title>');
   fs.writeFileSync(path.join(temp,'.env'),'FORBIDDEN_SECRET=secret');
   const child = spawn(process.execPath,[serverEntry],{
     cwd:temp,stdio:['ignore','pipe','pipe'],
     env:{...process.env,PORT:String(port),OA_TEST_SANDBOX:'1',DATABASE_URL:'',DOTENV_CONFIG_PATH:path.join(temp,'absent.env'),GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',OA_WEB_DIST_DIR:temp,ADMIN_EMAIL:'admin@example.org',ADMIN_PASSWORD:'not-a-real-password'},
   });
   let output='';
   child.stdout.on('data',d=>{output+=d.toString();});
   child.stderr.on('data',d=>{output+=d.toString();});
   const host=`http://127.0.0.1:${port}`;
   try {
     let started=false;
     for(let i=0;i<80;i++) {
       if(child.exitCode!==null)break;
       try {const response=await fetch(host+'/api/health');if(response.ok){started=true;break;}}
       catch {await delay(70);}
     }
     assert.ok(started,`Server failed to start: ${output.slice(-1000)}`);
     let response=await fetch(host+'/');
     assert.equal(response.status,200);
     assert.match(await response.text(),new RegExp(marker));
     response=await fetch(host+'/admin.html');
     assert.equal(response.status,200);
     assert.match(await response.text(),/OA Admin/);
     response=await fetch(host+'/admin',{redirect:'manual'});
     assert.equal(response.status,302);
     assert.equal(response.headers.get('location'),'/admin.html');
     response=await fetch(host+'/api/health');
     const health=await response.json();
     assert.equal(health.ok,true);
     response=await fetch(host+'/api/admin/stats');
     assert.equal(response.status,401);
     response=await fetch(host+'/.env');
     assert.equal(response.status,404);
   } finally {
     child.kill('SIGTERM');
     await Promise.race([once(child,'exit'),delay(1500)]);
     fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
   }
 });
