/**
 * Auditable, offline intent boundary. No model calls or corpus-dependent scope decisions.
 * Layers: requested action + target + framing; university scope/context; entity senses;
 * then answer-bearing topic checks on retrieved TEXT, not a URL or lexical score alone.
 * Rules are deliberately conservative: uncertain requests ask for clarification.
 */
import {conversationalReply,queryTerms} from './quality.js';
import {resolveDialogue} from './dialogue.js';

const normalise=value=>String(value||'').normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/gu,'').replace(/[’ʼ`]/gu,"'").toLowerCase().replace(/\s+/gu,' ').trim();
const ROOM=/кабінет|аудиторі|приміщенн|навчальн\p{L}*\s+клас|classroom|teaching room|\boffice\b|\broom\b|\bcabinet\b/iu;
const ACCOUNT=/кабінет|обліков\p{L}*\s+запис|акаунт|\baccount\b|\bportal\b|\bcabinet\b/iu;
const APPLICANT=/вступник|абітурієнт|вступ|подан\p{L}*\s+заяв|приймальн|applicant|admission|application/iu;
const STUDENT=/студент|student/iu;
const DEVICE=/комп.?ютер(?!н\p{L}*\s+наук)|ноутбук|\bcomputers?\b(?!\s+science)|\blaptop\b|\bworkstation\b/iu;
const DIGITAL=/комп.?ютер|ноутбук|кабінет|акаунт|обліков|парол|мереж|сервер|систем|сайт|пошту|computer|laptop|account|password|network|server|system|website|portal|authentication|login/iu;
const ACADEMY=/науоа|острозьк\p{L}*\s+академ|ostroh\s+academy|\boa\.edu\.ua\b/iu;
const INSTITUTION=/університет|академі[яїює]|university|\bacademy\b|\bcampus\b/iu;
const REQUEST=/як\s|чим\s|(?:що|чи|які|який|яка|чому)\s|\b(?:how|what|which|why)\s|покрок|інструкц|навчи|підкаж|допоможи|поясни|покажи|розкажи|хочу|планую|збираюс|спосіб|дай\s|зроби|напиши|show\s|steps?\s|instructions?|help\s|write\s|make\s|want\s|give\s|teach\s|(?:can|could)\s+you/iu;
const BENIGN=/захист|запобіг|профілакт|убезпеч|виявити|розпізна|повідомити|повідомляти|відновити\s+(?:доступ|пароль)|protect|prevent|detect|report|recover|безпек|safety|security|чому.{0,35}(?:не\s+можна|небезпечно)|why.{0,35}(?:dangerous|illegal)|наслідк|consequences|етичн|ethical|(?:курс|вивча|навчають|course|teach|curriculum)/iu;
// Educational framing cannot license a separate operational request to harm/bypass.
const DIRECT_HARM=/(?:як|чим|how\s+(?:do\s+i|can\s+i|to)?)\s*(?:можна\s+|мені\s+|непомітно\s+|його\s+|i\s+)?(?:підпал|спал|підірв|злам|взлам|розбити|викрасти|вкрасти|обійти|hack|burn|torch|destroy|breach|compromise|cause|start|break\s+into|steal|bypass|crack)|(?:покроков|step.by.step|дай\s+код|(?:give|write).{0,35}(?:malware|ransomware|script|code))/iu;
const HARM_RELATIONS=[
 {action:/підпал|спалити|підірв|знищити|зіпсувати|розбити|set.{0,25}(?:on\s+fire|fire\s+to)|\b(?:burn|torch|destroy|blow\s+up)\b/iu,target:/кабінет|аудитор|будівл|приміщ|гуртожит|майн|комп.?ютер|office|classroom|building|dorm|property|computer|cabinet/iu},
 {action:/(?:злам|взлам|злом|вкрасти|викрасти|обійти)|\b(?:hack|crack|steal|bypass|breach|compromise)\b|break\s+into/iu,target:DIGITAL},
 {action:/спричинити|влаштувати|вчинити|\b(?:cause|start)\b/iu,target:/пожеж|вибух|\bfire\b|\bexplosion\b/iu},
 {action:/виготов|зробити|зібрати|\b(?:make|build|assemble)\b/iu,target:/бомб|вибухів|вибухов\p{L}*\s+пристр|\b(?:bomb|explosive)\b/iu},
 {action:/напиши|створи|запусти|\b(?:write|create|deploy)\b/iu,target:/шкідлив\p{L}*\s+код|вірус|кейлог|malware|ransomware|keylogger|phishing/iu},
 {action:/підроб|фальсифіку|\bforge\b|falsify/iu,target:/диплом|документ|оцінк|diploma|document|grades?/iu},
];

function safety(text){
 const clauses=text.split(/[.!?;\n]+/u);
 if(clauses.length>1&&text.length<=500)clauses.push(text.replace(/[.!?;\n]+/gu,' '));
 for(const clause of clauses){
  const paired=HARM_RELATIONS.some(({action,target})=>{
   const a=action.exec(clause),b=target.exec(clause);
   return a&&b&&Math.abs(a.index-b.index)<=160;
  });
  if(!paired)continue;
  const request=REQUEST.test(clause)||/^(?:а\s+)?(?:підпали|підпалити|зламай|зламати|взламай|взламати|спали|підірви|hack\s|burn\s|destroy\s)/iu.test(clause.trim());
  const negatedInstruction=/^не\s+(?:пояснюй|показуй|надавай|розповідай)|^do\s+not\s+(?:show|explain|provide)/iu.test(clause.trim());
  const directAction=DIRECT_HARM.test(clause)||/(?:хочу\s+(?:навчитися\s+)?|want\s+to\s+|teach\s+me\s+to\s+)(?:підпал|злам|взлам|обійти|спалити|hack|bypass|compromise|burn)/iu.test(clause)
   ||/(?:щоб|для\s+того\s+щоб|(?:way|tools?|materials?).{0,35}to)\s+(?:підпал|злам|взлам|обійти|спалити|hack|bypass|burn|set.{0,20}fire)/iu.test(clause);
  const educationalDefinition=/(?:що\s+таке|what\s+is|what\s+are|чому.{0,50}(?:небезпеч|незакон)|why.{0,50}(?:dangerous|illegal))/iu.test(clause);
  if(request&&!negatedInstruction&&(!(BENIGN.test(clause)||educationalDefinition)||directAction))return 'harmful_action';
 }
 if(/(?:пожежа|горить|дим\p{L}*|\bfire\b|\bsmoke\b)/iu.test(text)
   &&/(?:що\s+робити|куди\s+(?:бігти|звер|повідом)|як\s+діяти|what\s+(?:should\s+i\s+)?do|what\s+to\s+do|who.{0,25}report)/iu.test(text)
   &&!/(?:профілакт|запобіг|prevent)/iu.test(text))return 'immediate_safety';
 return null;
}

// Task predicates, not a ban on mentioning these words. Campus policies about food,
// weather-related closures, programming courses etc. remain university questions.
function unrelatedTask(text){
 return /(?:як\s+(?:приготувати|спекти|зварити)|рецепт\s+(?:борщу|страв|торт)|how\s+to\s+(?:cook|bake)|recipe\s+for)/iu.test(text)
  || /(?:яка\s+погода|прогноз\s+погоди|what.{0,15}weather|weather\s+forecast)/iu.test(text)
  || /(?:напиши|написати|write|implement).{0,35}(?:код|скрипт|алгоритм|code|script|sorting algorithm)/iu.test(text)
  || /(?:напиши|склади|write).{0,20}(?:вірш|казк|poem|fairy\s+tale)|розкажи\s+анекдот|tell.{0,15}joke/iu.test(text)
  || /(?:курс\s+(?:біткоїн|долар|валют)|купити\s+акці|ціна\s+біткоїн|bitcoin\s+price|stock\s+price)/iu.test(text)
  || /(?:скільки.{0,15}коштує|ціна|how\s+much|price).{0,30}(?:телефон|ноутбук|iphone|laptop|bitcoin)/iu.test(text)
  || /(?:як\s+(?:замінити|полагодити)|how\s+to\s+(?:replace|repair)).{0,25}(?:колесо|двигун|автомоб|tyre|tire|engine|car)/iu.test(text);
}
const TOPICS=[
 ['admission',/вступ|абітурієнт|приймальн\p{L}*\s+коміс|admission|applicant|apply\s+(?:to|for).{0,25}(?:university|degree)/iu],
 ['tuition',/вартіст\p{L}*\s+навчан|оплат\p{L}*.{0,12}навчан|tuition|навчан\p{L}*.{0,20}(?:кошту|вартіст)|магістратур\p{L}*.{0,20}вартіст/iu],
 ['programme',/спеціальн|освітн\p{L}*\s+програм|факультет|інститут|магістр|бакалавр|аспірант|комп.?ютерн\p{L}*\s+наук|degree|bachelor|master|\bphd\b|computer\s+science|study\s+program|facult|department/iu],
 ['housing',/гуртожит|поселен|заселен|dormitor|\bdorms?\b|student\s+(?:housing|accommodation)/iu],
 ['scholarship',/стипенд|scholarship/iu],
 ['library',/бібліотек|бібліотеці|\blibrary\b/iu],
 ['schedule',/розклад|розклад\p{L}*\s+дзвін|занятт|\btimetable\b|class\s+schedule|lecture/iu],
 ['academic_leave',/академічн\p{L}*\s+відпуст|academic\s+leave/iu],
 ['contacts',/контакт|адрес\p{L}*\s+(?:академ|університет)|приймальн\p{L}*.{0,20}телефон|\bcontacts?\b|university\s+address/iu],
 ['leadership',/ректор|ректорат|rector|university\s+president/iu],
 ['history',/(?:засн|відрод|історі).{0,45}(?:академ|університет)|(?:академ|університет).{0,45}(?:засн|відрод|історі)|(?:history|found|establish|reviv).{0,55}(?:academy|university)/iu],
 ['international',/міжнародн\p{L}*\s+(?:партнер|співпрац|програм|відносин|обмін)|erasmus|international\s+(?:partner|exchange|cooperation)|exchange\s+program/iu],
];
function profile(text){
 const topics=TOPICS.filter(([,rx])=>rx.test(text)).map(([id])=>id),senses=[];
 if(ACCOUNT.test(text)&&APPLICANT.test(text))senses.push('applicant_account');
 if(ACCOUNT.test(text)&&STUDENT.test(text))senses.push('student_account');
 if(!senses.length&&/(?:електронн\p{L}*\s+кабінет|electronic\s+(?:cabinet|account))/iu.test(text))senses.push('applicant_account');
 if(/навчальн\p{L}*\s+кабінет|аудиторі|фізичн\p{L}*\s+кабінет|classroom|teaching\s+room/iu.test(text))senses.push('physical_room');
 if(DEVICE.test(text)&&/(?:навчальн|університет|академ|лаборатор|campus|university|teaching|\blab\b)/iu.test(text))senses.push('campus_device');
 const protective=BENIGN.test(text)&&/(?:захист|безпек|профілакт|запобіг|protect|prevent|security|safety|detect|report)/iu.test(text);
 const task=/вартіст|кошту|ціна|\bcost\b|\bprice\b|\bfees?\b|how\s+much/iu.test(text)?'cost'
  :/віднов|скинут|забув|reset|recover|forgot/iu.test(text)&&/парол|доступ|password|access/iu.test(text)?'recover'
  :/реєстр|створити.{0,20}(?:кабінет|запис)|register|registration|create.{0,20}account/iu.test(text)?'register'
  :/увій|вхід|зайти|авторизац|\blog\s*in\b|\bsign\s*in\b|\baccess\b/iu.test(text)?'login':null;
 return {topics:[...new Set(topics)],senses:[...new Set(senses)],protective,task};
}
const FOLLOWUP=/^(?:а(?:\s|[,?!])|і\s|та\s|ні[,\s]|саме\s|для\s|щодо\s|а\s+щодо|уточн|цікав|загальні\s+умови|детальніше|докладніше|покроково|and\b|what\s+about|for\b|more\s+details|step\s+by\s+step)|^(?:це|там|він|вона|вони|його|it|that|those)\b|^(?:20\d{2}|документи|пароль|магістратура|бакалаврат)[?!.\s]*$/iu;
const PRICE_FOLLOWUP=/^(?:а\s+)?(?:скільки\s+(?:це\s+)?кошту|яка\s+вартіст|how\s+much|what\s+(?:does\s+it\s+cost|is\s+the\s+cost))/iu;
function isElliptic(text){
 const q=text.replace(/^(?:а|і|та|and|what\s+about)[,\s]+/iu,'').trim();
 const short=q.split(' ').length<=5;
 if(short&&(resolveDialogue(q).programme||/^(?:заочн\p{L}*|денн\p{L}*|студентськ\p{L}*|вступник\p{L}*|student|applicant|part.time|full.time|20\d{2}|так|ні|yes|no)[?!.\s]*$/iu.test(q)))return true;
 if(/^(?:як\s+відновити\s+пароль|how\s+(?:do\s+i\s+)?(?:reset|recover).{0,15}password)[?!.\s]*$/iu.test(q))return true;
 if(/^(?:(?:які|яка|який|а\s+як|як|how\s+do\s+i)\s+)?(?:документ\p{L}*|строк\p{L}*|термін\p{L}*|іспит\p{L}*|вартіст\p{L}*|ціна|парол\p{L}*|докладніше|детальніше|покроково|documents?|deadlines?|exams?|fees?|password|more\s+details|step.by.step)[?!.\s]*$/iu.test(q))return true;
 if(/^(?:(?:саме|цікавлять|цікавлять\s+саме)\s+)?(?:загальні\s+умови|для\s+всіх)[?!.\s]*$/iu.test(q))return true;
 if(/^(?:скільки\s+(?:це\s+)?кошту\p{L}*|яка\s+вартіст\p{L}*|how\s+much(?:\s+(?:does\s+it\s+cost|is\s+it))?)[?!.\s]*$/iu.test(q))return true;
 return q.split(' ').length<=12&&/(?<!\p{L})(?:це|там|він|вона|його|її|цей|той|it|that|them)(?!\p{L})/iu.test(q);
}

function rawAssessment(text){
 const risk=safety(text),p=profile(text);
 if(risk==='harmful_action')return {kind:'safety_refusal',reason:risk,profile:p};
 if(risk==='immediate_safety')return {kind:'safety_guidance',reason:risk,profile:p};
 if(conversationalReply(text))return {kind:'conversation',reason:'social',profile:p};
 if(unrelatedTask(text))return {kind:'out_of_scope',reason:'unrelated_task',profile:p};
 const otherInstitution=/(?:київськ|львівськ|харківськ|варшавськ|оксфорд|гарвард|harvard|oxford|cambridge|stanford|kyiv|warsaw).{0,30}(?:університет|академ|university)|(?:university\s+of\s+(?:oxford|cambridge|warsaw|kyiv))|(?:кну|кпі|kpi)\b/iu.test(text);
 if(otherInstitution&&!ACADEMY.test(text))return {kind:'out_of_scope',reason:'other_institution',profile:p};
 if(p.senses.length||p.topics.length||ACADEMY.test(text)||INSTITUTION.test(text))return {kind:'university',reason:'domain_intent',profile:p};
 if(ROOM.test(text)||ACCOUNT.test(text)||DEVICE.test(text)||/^(?:документи|пароль|ціна|documents|password|cost)[?!.\s]*$/iu.test(text))return {kind:'clarification',reason:ACCOUNT.test(text)?'account_sense':DEVICE.test(text)?'device_sense':'uncertain_subject',profile:p};
 return {kind:'out_of_scope',reason:'no_university_intent',profile:p};
}

/** History is only user-supplied subject context, never permission or evidence. */
export function assessRequest(message,history=[],lang='uk'){
 const text=normalise(message),base=rawAssessment(text);
 const previousUsers=(Array.isArray(history)?history:[]).filter(m=>m?.role==='user'&&typeof m.content==='string').slice(-6);
 let previous=null;
 for(const turn of previousUsers){
  const q=normalise(turn.content),decision=rawAssessment(q);
  if(previous&&isElliptic(q)&&['out_of_scope','clarification'].includes(decision.kind)&&!['unrelated_task','other_institution'].includes(decision.reason)){
   previous={...previous,text:`${previous.text} — ${q}`};continue;
  }
  previous={...decision,text:q};
 }
 const followup=isElliptic(text)||(base.kind==='university'&&FOLLOWUP.test(text))||/^(?:а\s+)?(?:як\s+відновити\s+пароль|how\s+(?:do\s+i\s+)?(?:reset|recover).{0,15}password)/iu.test(text);
 if(previous?.kind==='university'&&followup&&!['safety_refusal','safety_guidance'].includes(base.kind)){
  // Resolve anaphoric targets ("А як зламати його?") without copying old actions
  // or benign framing into the current request's safety decision.
  const target=previous.profile.senses.includes('campus_device')?"навчальний комп'ютер campus computer"
   :previous.profile.senses.some(s=>s.endsWith('_account'))?'обліковий запис account'
   :ROOM.test(previous.text)?'кабінет classroom':DEVICE.test(previous.text)?"комп'ютер computer":'';
  if(target&&safety(`${text.replace(/[.!?;]/gu,' ')} ${target}`)==='harmful_action')return localDecision({...base,kind:'safety_refusal',reason:'contextual_harmful_action'},lang);
 }
 // A self-contained harmful/unrelated task cannot inherit university legitimacy.
 if(!['safety_refusal','safety_guidance','conversation'].includes(base.kind)&&previous&&followup
   &&!['unrelated_task','other_institution'].includes(base.reason)){
  if(previous.kind==='safety_refusal'&&base.kind!=='university')return localDecision({...base,kind:'safety_refusal',reason:'harmful_followup'},lang);
  if(previous.kind==='university'){
   let p=base.profile;
   if(!p.senses.length&&previous.profile.senses.length&&(base.kind!=='university'||ACCOUNT.test(text)||/парол|password/iu.test(text)||STUDENT.test(text))){
    const senses=STUDENT.test(text)?['student_account']:APPLICANT.test(text)?['applicant_account']:previous.profile.senses;
    p={...p,senses};
   }
   if(base.kind!=='university'||!p.topics.length)p={...p,topics:p.topics.length?p.topics:previous.profile.topics};
   const labels=lang==='en'?{applicant_account:'applicant account',student_account:'student portal',physical_room:'university classroom',campus_device:'campus computer'}
    :{applicant_account:'електронний кабінет вступника',student_account:'студентський кабінет',physical_room:'навчальна аудиторія університету',campus_device:'навчальний комп’ютер університету'};
   // Carry the subject, not a stale action (login must not dilute password recovery).
   const subject=p.senses.length?p.senses.map(s=>labels[s]).join(', '):previous.text;
   return {...base,kind:'university',reason:'contextual_subject',contextUsed:true,profile:p,searchQuestion:`${text} — ${subject}`};
  }
 }
 return localDecision(base,lang);
}
function localDecision(decision,lang){
 const en=lang==='en';let answer;
 if(decision.kind==='safety_refusal')answer=en
  ?'I cannot provide instructions for causing harm or gaining unauthorized access. I can help with safety, prevention, and protecting university accounts or equipment.'
  :'Не можу надати інструкції для заподіяння шкоди чи несанкціонованого доступу. Можу допомогти з безпекою, профілактикою та захистом університетських облікових записів або обладнання.';
 if(decision.kind==='safety_guidance')answer=en
  ?'If there is a fire or smoke, move away from danger and alert emergency services and the university’s responsible staff. Follow the building’s evacuation instructions.'
  :'Якщо є пожежа або дим, відійдіть від небезпеки та повідомте екстрені служби й відповідальних працівників університету. Дотримуйтеся вказівок щодо евакуації з будівлі.';
 if(decision.kind==='out_of_scope')answer=en
  ?'I specialize in Ostroh Academy: admissions, study programmes, university services and student life. I can help with questions about these topics.'
  :'Я спеціалізуюся на питаннях Острозької академії: вступі, освітніх програмах, університетських сервісах і студентському житті. Можу допомогти з цими темами.';
 if(decision.kind==='clarification')answer=decision.reason==='account_sense'
  ?en?'Do you mean an applicant account, a student portal, or a physical university office/classroom?':'Ви маєте на увазі електронний кабінет вступника, студентський онлайн-кабінет чи фізичний кабінет або аудиторію університету?'
  :en?'Could you clarify how your question relates to Ostroh Academy: a university service, a classroom, equipment, or a study programme?':'Уточніть, будь ласка, як ваше питання пов’язане з Острозькою академією: із сервісом університету, аудиторією, обладнанням чи освітньою програмою?';
 return {...decision,...(answer?{answer,sourceType:decision.kind}:{})};
}

// Evidence must support the intended sense in the actual chunk. University branding,
// a shared term such as "cabinet", or a high MiniSearch/LSA score is insufficient.
const EVIDENCE_TOPICS={
 admission:APPLICANT,tuition:/вартіст|оплат|грн|tuition|fees?|uah/iu,
 programme:/спеціальн|освітн\p{L}*\s+програм|факультет|інститут|магістр|бакалавр|аспірант|навчан|degree|study|course|program|faculty|department|science/iu,
 housing:/гуртожит|поселен|проживан|dorm|accommod|housing/iu,scholarship:/стипенд|scholarship/iu,
 library:/бібліотек|бібліотеці|library|каталог|catalogue/iu,schedule:/розклад|занятт|пари|дзвінк|timetable|schedule|classes/iu,
 academic_leave:/академічн\p{L}*\s+відпуст|academic\s+leave/iu,contacts:/адрес|телефон|контакт|email|@|address|contact|phone/iu,
 leadership:/ректор|rector|president/iu,history:/заснов|заснува|відрод|історі|found|establish|reviv|history/iu,
 international:/міжнародн|партнер|обмін|international|partner|exchange|erasmus/iu,
};
function supportsSense(doc,sense){
 const text=normalise(doc.chunk||doc.answer),heading=normalise(doc.title||doc.question);
 if(sense==='applicant_account')return ACCOUNT.test(text)&&APPLICANT.test(text+' '+heading)&&!(!APPLICANT.test(text)&&STUDENT.test(text));
 if(sense==='student_account')return ACCOUNT.test(text)&&STUDENT.test(text+' '+heading)&&!(!STUDENT.test(text)&&APPLICANT.test(text));
 if(sense==='physical_room')return ROOM.test(text)&&/(?:аудитор|навчальн\p{L}*\s+кабінет|фізичн|корпус|приміщенн|classroom|teaching\s+room|building|office\s+(?:number|location))/iu.test(text)&&!(!/аудитор|classroom|teaching\s+room/iu.test(text)&&ACCOUNT.test(text)&&/(?:електрон|онлайн|portal|online)/iu.test(text));
 if(sense==='campus_device')return DEVICE.test(text)&&/(?:лаборатор|навчальн|підтримк|laborator|campus|support|teaching)/iu.test(text);
 return false;
}
export function evidenceMatches(doc,decision,query=''){
 if(decision.kind!=='university')return false;
 const text=normalise(doc.chunk||doc.answer);
 if(!text)return false;
 const specific=profile(query),p={topics:specific.topics.length?specific.topics:decision.profile.topics,senses:specific.senses.length?specific.senses:decision.profile.senses,protective:specific.protective||decision.profile.protective,task:specific.task||decision.profile.task};
 if(p.senses.length){
  if(!p.senses.some(sense=>supportsSense(doc,sense)))return false;
  if(p.task==='cost'&&!/(?:вартіст|кошту|грн|безкоштовн|\bcost\b|\bprice\b|\bfees?\b|\bfree\b|\buah\b)/iu.test(text))return false;
  if(p.senses.some(s=>s.endsWith('_account'))&&p.task){
   const taskEvidence={cost:/вартіст|кошту|грн|безкоштовн|cost|price|fees?|free|uah/iu,recover:/віднов|скинут|забув|reset|recover|forgot|підтримк|support/iu,register:/реєстр|створ|register|registration|create/iu,login:/увій|вхід|зайти|авторизац|log\s*in|sign\s*in|access/iu};
   if(!taskEvidence[p.task].test(text))return false;
  }
  if(p.senses.includes('physical_room')&&/(?:\bwhere\b|де\s|номер\s|якій\s+аудитор)/iu.test(query)&&!/(?:розташ|знаход|корпус|номер|поверх|location|building|room\s+number|floor)/iu.test(text))return false;
  if(p.protective&&!/(?:захист|безпек|парол|профілакт|евакуац|запобіг|protect|security|safety|prevent|password|evacuat|report)/iu.test(text))return false;
  return true;
 }
 if(p.topics.length){
  // Degree/programme and admissions are often qualifiers of a more precise need.
  const focused=p.topics.filter(topic=>!['programme','admission'].includes(topic));
  return (focused.length?focused:p.topics).some(topic=>EVIDENCE_TOPICS[topic]?.test(text));
 }
 // For an explicit university question outside the known topic profiles, require
 // actual subject overlap beyond institution names and generic question words.
 const terms=queryTerms(query).filter(t=>!['кабінет','компютер','університет','академія','острог','науоа','інформац','розкаж'].includes(t));
 const bodyTerms=new Set(queryTerms(text));
 return terms.length?terms.some(t=>bodyTerms.has(t)):INSTITUTION.test(text);
}
export function filterEvidence(documents,decision,query=''){
 return (Array.isArray(documents)?documents:[]).filter(doc=>evidenceMatches(doc,decision,query));
}
