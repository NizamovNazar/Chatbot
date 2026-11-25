/**
 * Strictly grounded, deterministic answers for recurring factual questions.
 * Content is extracted from the locally indexed university documents. No
 * invented contacts, admissions rules, fees or institutional structures.
 */
const source=(d)=>({title:d.title,url:d.url});
const norm=(s)=>String(s||'').trim();
const lines=(s)=>norm(s).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const findPage=(docs,tail)=>docs.find(d=>String(d.url||'').replace(/\/$/,'')===tail);
const pick=(docs,url,re)=>{
 const matching=docs.filter(d=>String(d.url||'').replace(/\/$/,'')===url);
 return matching.find(d=>re.test(String(d.chunk||'')))||matching[0];
};
const match=(s,re)=>norm(s).match(re)?.[0]||null;
const official='https://www.oa.edu.ua';
const admission='https://vstup.oa.edu.ua';
function response(answer,doc){return doc&&answer?{type:'verified_local',evidenceMode:'extracted',answer,sources:[source(doc)]}:null;}
export function answerGroundedOffline(question, lang='uk', documents=[]) {
 const q=norm(question); if(!q||!Array.isArray(documents))return null;
 const english=lang==='en'||(/\b(?:what|where|who|how|which|when|is|does|can|university|admissions|official)\b/i.test(q)&&!/[а-яіїєґ]/iu.test(q));
 const isAdmissions=/(?:приймальн\p{L}*\s+комісі|вступн\p{L}*\s+комісі|абітурієнт|admissions?\s+(?:office|committee)|admission\s+email)/iu.test(q);
 const wantsContacts=/(?:контакт|адрес|телефон|поштов|електронн\p{L}*\s+адрес|email|e-?mail|phone|contact|address|зв[’'ʼ]?язат|звернут)/iu.test(q);
 if(wantsContacts) {
   const d=pick(documents,isAdmissions?`${admission}/kontakti`:`${official}/ua/contacts`,/./);
   if(d){
     const text=norm(d.chunk);
     if(isAdmissions){
       const email=match(text,/\bvstup@oa\.edu\.ua\b/i);
       const tel=match(text,/\b(?:\+?38\s*)?0?97\s*553\s*7410\b/u);
       if(email && tel)return response(english
         ?`According to Ostroh Academy's official admissions contacts page, the admissions office email is ${email} and the phone number is ${tel}.`
         :`За офіційною сторінкою приймальної комісії Острозької академії, електронна адреса: ${email}; телефон: ${tel}.`,d);
     }else {
       const email=match(text,/\bosa@oa\.edu\.ua\b/i);
       const address=match(text,/вул\.\s*Семінарська\s*2/iu);
       if(email&&address){
         const isEnglish=english || /university\s+address|official\s+contact/iu.test(q);
         return response(isEnglish
          ?`The university's official contacts page lists the address as «${address}». General email: ${email}.`
          :`На офіційній сторінці контактів зазначена адреса: ${address}. Загальна електронна пошта: ${email}.`,d);
       }
     }
   }
 }
 // Full list must come from the canonical institutes page, not isolated faculty profiles.
 if(/(?:які|перелік|список|скільки|назви|what|which|list).{0,90}(?:навчально-науков\p{L}*\s+інститут|інститут\p{L}*\s+(?:працю|діють|є)|institutes?\s+(?:does|at|of))|(?:інститути).{0,40}(?:острозьк|академі)/iu.test(q)) {
   const d=findPage(documents,`${official}/ua/departments`);
   const institutes=d?lines(d.chunk).filter(x=>/^Навчально-науковий інститут /iu.test(x)):[];
   const unique=[...new Set(institutes)];
   if(unique.length>=3) return response(english
      ?`The available official institutes list contains ${unique.length} entries:\n${unique.map((x,i)=>`${i+1}. ${x}`).join('\n')}`
      :`У доступному офіційному переліку зазначено ${unique.length} навчально-наукових інститутів:\n${unique.map((x,i)=>`${i+1}. ${x}`).join('\n')}`,d);
 }
 if(/(?:історі\p{L}*\s+відроджен|відроджен\p{L}*\s+академ|коли\s+відрод|revival|restor(?:ation|ed))|(?:відновлен\p{L}*\s+діяльност)/iu.test(q)) {
   const d=pick(documents,`${official}/ua/info/history`,/Хроніка відродження.+1994/u);
   if(d && /(?:відроджен|відновлен)[\s\S]{0,180}1994|1994[\s\S]{0,180}(?:відроджен|відновлен)/iu.test(d.chunk))return response(english
     ?'The official history page dates the revival of Ostroh Academy to 1994.'
     :'Офіційна історична сторінка пов’язує відродження Острозької академії з 1994 роком.',d);
 }
 if(/(?:коли|якого\s+року|у\s+якому\s+році|when).{0,60}(?:заснова|створ|founded).{0,55}(?:академ|university)|(?:заснован\p{L}*).{0,55}(?:острозьк)/iu.test(q)){
   const d=pick(documents,`${official}/ua/info/history`,/Заснував академію у 1576 році/u);
   if(d&&/(?:заснував|заснован)[\s\S]{0,90}1576|1576[\s\S]{0,90}заснован/iu.test(d.chunk))return response(english?'The official history page dates the founding of Ostroh Academy to 1576.':'На офіційній історичній сторінці роком заснування Острозької академії зазначено 1576.',d);
 }
 if(/(?:які|види|типи|перелік|what|types?).{0,55}(?:стипенд|scholarship)|(?:стипенд).{0,50}(?:студент|академі)/iu.test(q)){
   const d=pick(documents,`${official}/ua/etc/scholarship-support`,/Стипендії та гранти української діаспори/u);
   if(d){const t=d.chunk;
     const types=[];
     if(/академічна стипендія/iu.test(t))types.push(english?'academic scholarships':'академічні стипендії');
     if(/Стипендії та гранти української діаспори/iu.test(t))types.push(english?'scholarships and grants from the Ukrainian diaspora':'стипендії та гранти української діаспори');
     if(/Іменні та персональні гранти/iu.test(t))types.push(english?'named and personal grants':'іменні й персональні гранти');
     if(types.length>=2)return response(english
       ?`The university's scholarship information page mentions: ${types.join('; ')}. This is not necessarily an exhaustive list of all government support programmes. Check the university page for eligibility and current awards.`
       :`На офіційній сторінці стипендійного забезпечення академії згадані:\n${types.map((x,i)=>`${i+1}. ${x}`).join('\n')}\nЦе перелік підтверджених на сторінці видів підтримки, а не вичерпний перелік усіх державних виплат. Умови призначення варто перевірити за джерелом.`,d);
   }
 }
 if(/(?:гуртожит|поселен|dormitory|dormitories|student housing)/iu.test(q) && /(?:де|як|умов|проживан|поселен|адрес|вартіст|оплат|where|how|location|fee|cost)/iu.test(q)){
   const d=pick(documents,`${admission}/umovi-navchannya/gurtozhitki`,/Для студентів Острозької академії є 8 гуртожитків/u);
   const addressDoc=pick(documents,`${admission}/umovi-navchannya/gurtozhitki`,/Гуртожиток № 4, вул/u);
    if(d&&addressDoc && /для першокурсників/.test(d.chunk) && /Житлової комісії/iu.test(d.chunk)){
     const text=addressDoc.chunk;
     const addresses=[];
     for(const [pattern,name] of [
       [/№ 9, пр\. Незалежності, 62/iu,'гуртожиток № 9 — пр. Незалежності, 62'],
       [/№ 10, пр\. Незалежності, 60/iu,'гуртожиток № 10 — пр. Незалежності, 60'],
       [/Гуртожиток № 4, вул\. Древлянська, 22/iu,'гуртожиток № 4 — вул. Древлянська, 22'],
       [/«Академічний дім», пр\. Незалежності, 5/iu,'«Академічний дім» — пр. Незалежності, 5'],
     ])if(pattern.test(text))addresses.push(name);
     if(addresses.length>=3){
       const amounts=/(?:вартіст|скільки кошту|оплат|cost|fees?|price|pay)/iu.test(q);
       const priceDoc=pick(documents,`${admission}/umovi-navchannya/gurtozhitki/vartist-prozhivannya-gurtozhitki`,/вартість|наказ/iu);
       const extra=amounts?' Конкретну оплату потрібно перевірити за чинним наказом університету про вартість проживання; у цьому переліку адрес тарифів немає.':'';
       const uk=`На сторінці університету наведені, зокрема, такі адреси:\n${addresses.map((x,i)=>`${i+1}. ${x}`).join('\n')}\nПорядок поселення першокурсників і звернення до Житлової комісії описані на цій сторінці.${extra}`;
       const en=`The official housing page lists these dormitory addresses: ${addresses.join('; ')}. The page also describes accommodation applications for first-year students and contacts with the Housing Commission.${amounts?' Check the current official housing-fee schedule for exact prices.':''}`;
       return {type:'verified_local',answer:english?en:uk,sources:[source(d),source(addressDoc),...(amounts&&priceDoc?[source(priceDoc)]:[])].filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i)};
     }
   }
 }
 if(/(?:як|графік|режим|години|коли|how|hours|opening).{0,90}(?:бібліотек|library)|(?:бібліотек|library).{0,90}(?:працю|графік|годин|відкрит|working|open|hours)/iu.test(q)){
   const d=pick(documents,`${official}/ua/resources/library`,/РЕЖИМ РОБОТИ/u);
   if(d&&/Сектор читальних залів/.test(d.chunk)&&/РЕЖИМ РОБОТИ/iu.test(d.chunk))return response(english
     ?'The official scientific library page includes a reading-room section and opening-hours information. Please check its linked schedule for the relevant service and date.'
     :'На офіційній сторінці наукової бібліотеки є відомості про сектор читальних залів і розділ «Режим роботи». Актуальний графік потрібного підрозділу перевірте за посиланням.',d);
 }
 if(/(?:які|назви|перелік|список|what|which).{0,80}(?:спеціальност|освітн\p{L}*\s+програм|degree programmes|majors)|(?:спеціальност).{0,40}(?:пропон|академ)/iu.test(q)){
   const d=pick(documents,`${admission}/specialnosti`,/Міжнародний туризм/u);
   if(d){
     const sample=['Міжнародний туризм','Культурологія: проєктна діяльність','Глобальний комунікаційний менеджмент','DATA-маркетинг та аналітика','Міжнародні відносини','Журналістика','Психологія','Початкова освіта'];
     const fromCatalog=documents.filter(x=>x.url===d.url);
     const found=sample.filter(x=>fromCatalog.some(xDoc=>String(xDoc.chunk||'').includes(x)));
     if(found.length>=4)return response(english
       ?`The official university programme catalogue lists, among others: ${found.join('; ')}. This is a selection, not the complete or degree-specific list; check the official catalogue to see the current admission programmes and study level.`
       :`В офіційному каталозі освітніх програм Острозької академії наведено, зокрема:\n${found.map((x,i)=>`${i+1}. ${x}`).join('\n')}\nЦе приклади програм, а не повний перелік спеціальностей. Актуальну доступність за рівнем освіти перевіряйте в каталозі за посиланням.`,d);
   }
 }
 if(/(?:акредит|акредитац|accredit)/iu.test(q) && /(?:освітн|програм|університет|академ|degree|program)/iu.test(q)){
   const d=pick(documents,`${admission}/perelik_osvitnikh_prohram`,/акредитованих та неакредитованих/iu);
   if(d&&/акредитованих та неакредитованих/iu.test(d.title))return {...response(english
     ?'The university publishes an official list that distinguishes accredited and non-accredited educational programmes. Accreditation must be checked for the specific programme and the relevant year; it is not safe to assume that every programme is accredited.'
      :'Університет публікує офіційний перелік акредитованих і неакредитованих освітніх програм. Статус акредитації потрібно перевіряти для конкретної програми та актуального року — не можна вважати, що всі програми акредитовані.',d),type:'navigation'};
 }
 return null;
}
