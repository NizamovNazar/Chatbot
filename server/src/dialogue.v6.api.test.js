import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function fixtureDocs() {
  return [
    {id:1,title:'Документи для магістратури | НаУОА',url:'https://vstup.oa.edu.ua/stati-magistrom/dokumenti-ta-stroki-prijomu',chunk:'У 2026 році документи для вступу до магістратури: диплом бакалавра та документи, що посвідчують особу. Подача заяви відбувається через електронний кабінет.'},
    {id:2,title:'Випробування до магістратури | НаУОА',url:'https://vstup.oa.edu.ua/stati-magistrom/jevi',chunk:'У 2026 році вступні випробування до магістратури включають ЄВІ та фахове випробування за правилами вступу.'},
    {id:3,title:'Вартість навчання магістр | НаУОА',url:'https://vstup.oa.edu.ua/stati-magistrom/vartist-navchannya',chunk:'У 2026 році вартість навчання для магістрів визначається договором із університетом. Вартість навчання залежить від освітньої програми.'},
    {id:4,title:'Гуртожитки студентів Острозької академії',url:'https://www.oa.edu.ua/ua/studentlife/gurtozhytky',chunk:'Студентські гуртожитки призначені для проживання студентів. Для поселення потрібно звернутися до відповідальної адміністрації.'},
    {id:5,title:'Бібліотека НаУОА',url:'https://www.oa.edu.ua/ua/resources/library',chunk:'Наукова бібліотека Острозької академії обслуговує студентів. У бібліотеці можна скористатися каталогом.'},
    {id:6,title:'Стипендії студентам',url:'https://www.oa.edu.ua/ua/studentlife/stypendii',chunk:'Стипендії студентам призначаються відповідно до положення університету.'}
  ];
}

test('V6 integration: contextual followups, topic switch, multiple independent questions without remote AI', {timeout:25000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oa-dialogue-v6-'));
  fs.mkdirSync(path.join(dir,'data')); fs.writeFileSync(path.join(dir,'data/docs.json'),JSON.stringify(fixtureDocs()));
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(ok=>listener.close(ok));
  const child=spawn(process.execPath,[path.resolve('src/index.js')],{
    cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PORT:String(port),GEMINI_API_KEY:'',OPENROUTER_API_KEY:'',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',DOTENV_CONFIG_PATH:path.join(dir,'none.env'),ADMIN_EMAIL:'demo@test.invalid',ADMIN_PASSWORD:'demoPassword1!'}
  });
  let err='';child.stderr.on('data',d=>err+=d.toString());
  async function request(message,history=[]) {
    const res=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,lang:'uk',history}),signal:AbortSignal.timeout(7000)});
    return {status:res.status,body:await res.json()};
  }
  try {
    let ready=false;for(let i=0;i<70;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){ready=true;break}}catch{};if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
    assert.ok(ready,err);
    const initial='Я хочу вступити на магістратуру F3 у 2027 році.';
    const multi=await request('А які документи та вступні іспити?', [{role:'user',content:initial}]);
    assert.equal(multi.status,200);
    assert.equal(multi.body.sourceType,'multi_extract');
    assert.match(multi.body.answer,/Документи для вступу/);
    assert.match(multi.body.answer,/Вступні випробування/);
    assert.match(multi.body.answer,/2027/);
    // Rules from 2026 cannot be presented as guaranteed 2027 requirements.
    assert.doesNotMatch(multi.body.answer,/У 2027 році вступні випробування.*включають ЄВІ/);
    const housing=await request('А де гуртожитки?', [{role:'user',content:initial}]);
    assert.equal(housing.status,200);
    assert.doesNotMatch(housing.body.answer,/2027 році/);
    const studentLife=await request('Які є гуртожитки, стипендії та бібліотека?');
    assert.equal(studentLife.status,200);
    assert.equal(studentLife.body.sourceType,'multi_extract');
    assert.match(studentLife.body.answer,/Гуртожитки та поселення/);
    assert.match(studentLife.body.answer,/Стипендії/);
    assert.match(studentLife.body.answer,/Бібліотека/);
    const unknown=await request('Яка точна вартість магістратури F3 у 2029 році?');
    assert.equal(unknown.status,200);
    assert.match(unknown.body.answer,/2029|не знайшов|Не знайшов|Не вдалося/);
  } finally {
    child.kill();await Promise.race([once(child,'exit').catch(()=>{}),new Promise(done=>setTimeout(done,750))]);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
