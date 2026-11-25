/**
 * Deterministic, auditable dialogue context resolver. Does not infer facts
 * from assistant messages: conversation history is only used to recover the
 * user's previously expressed intent, study level, programme and year.
 */
const YEAR = /\b20\d{2}\b/g;
const TOPICS = [
  ['housing', /гуртожит|поселен|заселен|проживан|dorm|housing|accommodat/iu],
  ['scholarship', /стипенд|scholarship|stipend/iu],
  ['academic_leave', /академічн\p{L}*\s+відпуст|academic\s+leave/iu],
  ['library', /бібліоте(?:к|ц)|librar/iu],
  ['rector', /ректор|rector/iu],
  ['schedule', /розклад|пари\s+на|заняття\s+на|timetable|schedule/iu],
  ['international', /міжнародн|обмін\p{L}*\s+студент|erasmus|international|exchange\s+program/iu],
  ['admission', /вступ|абітурієнт|вступн\p{L}*\s+випроб|єві|єфвв|приймальн\p{L}*\s+коміс|admission|applicant|entrance\s+exam/iu],
  ['tuition', /вартіст\p{L}*\s+навчан|кошту\p{L}*\s+навчан|оплат\p{L}*\s+навчан|tuition|course\s+fee/iu],
  ['programme', /спеціальн|освітн\p{L}*\s+програм|факультет|інститут|degree\s+program|specialt/iu],
];
const FOLLOWUP = /^(?:а\s|і\s|іще\s|а\s+щодо|щодо\s|а\s+для|для\s+(?:магістр|бакалавр)|цікавлять?\s|саме\s|загальні\s+умови|уточн\p{L}*\s*[:,-]|маю\s+на\s+увазі|ні[,\s]|не\s+\d|але\s|what\s+about|and\s|for\s+(?:master|bachelor)|instead\s|actually\s)/iu;
const FILLER = /^(?:а\s+)?(?:що\s+щодо\s+)?(?:це|там|тоді|а\s+це|про\s+це|докладніше|подробиці|детальніше|розкажи\s+детальніше)[?!.\s]*$/iu;
const EXPLICIT_NEW = /^(?:нова\s+тема|інше\s+питання|тепер\s+про\s+інше|змінимо\s+тему|new\s+topic|different\s+question)/iu;
const STUDY = [
  ['master', /магістр\p{L}*|master'?s?/iu],
  ['bachelor', /бакалавр\p{L}*|bachelor'?s?|undergraduate/iu],
  ['phd', /аспірант\p{L}*|доктор\p{L}*\s+філософ|phd|doctoral/iu],
];
const STUDY_LABEL = { master: 'магістратура', bachelor: 'бакалаврат', phd: 'аспірантура' };
const EN_STUDY_LABEL = { master: 'master degree', bachelor: 'bachelor degree', phd: 'PhD' };

function detectLevel(text) {
  // Explicitly corrected study levels must override earlier mentions in the same message.
  const hits = STUDY.flatMap(([name, rx]) => {
    const global = new RegExp(rx.source, 'giu');
    return [...String(text).matchAll(global)].map(hit => ({ name, offset: hit.index }));
  }).sort((a, b) => a.offset - b.offset);
  if (!hits.length) return null;
  const change = /не\s+(?:магістр\p{L}*|бакалавр\p{L}*).*?(?:а|натомість)(?=\s|[,;:])\s*/iu.test(text);
  return change ? hits.at(-1).name : hits[0].name;
}
function detectProgramme(text) {
  const t = String(text || '');
  const code = t.match(/(?:спеціальн\p{L}*\s+|specialty\s+)([A-ZА-Я]\d{1,3})\b/iu);
  const programmes=[
    ['F3 «Комп’ютерні науки»',/\bF3\b|комп[’'`ʼ]?ютерн\p{L}*\s+наук|computer\s+science/iu],
    ['Економічна кібернетика',/економічн\p{L}*\s+кібернет|economic\s+cybernetic/iu],
    ['Право',/(?<!\p{L})(?:право|права|праві|правознав\p{L}*|law)(?!\p{L})/iu],
    ['Психологія',/психолог\p{L}*|psychology/iu],
    ['Журналістика',/журналіст\p{L}*|journalism/iu],
    ['Міжнародні відносини',/міжнародн\p{L}*\s+відносин\p{L}*|international relations/iu],
    ['Політологія',/політолог\p{L}*|political science/iu],
    ['Філологія',/філолог\p{L}*|philology/iu],
    ['Громадське здоров’я',/громадськ\p{L}*\s+здоров|public health/iu],
    ['Історія та археологія',/історі\p{L}*\s+та\s+археолог/iu],
    ['Національна безпека',/національн\p{L}*\s+безпек/iu],
    ['Початкова освіта',/початков\p{L}*\s+освіт/iu],
  ];
  const hits=programmes.flatMap(([name,re])=>{const hit=re.exec(t);return hit?[{name,offset:hit.index}]:[]}).sort((a,b)=>a.offset-b.offset);
  const codeOffset=code?code.index+code[0].lastIndexOf(code[1]):-1;
  if(code&&!hits.some(h=>h.offset===codeOffset))hits.push({name:code[1],offset:codeOffset});
  hits.sort((a,b)=>a.offset-b.offset);
  return /(?:не\s|натомість|замість)/iu.test(t)?hits.at(-1)?.name||null:hits[0]?.name||null;
}
function detectYear(text) {
  const matches = [...String(text).matchAll(YEAR)];
  if (!matches.length) return null;
  // "не 2027, а 2026" -> latest mentioned year is the requested one.
  if (/не\s+20\d{2}[\s\S]{0,30}(?:,\s*а\s+|\s+натомість\s+|\s+замість\s+)/iu.test(text)
    || /(?:виправ|correct|instead|замість)/iu.test(text)) return matches.at(-1)[0];
  return matches[0][0];
}
function classifyTopic(text) {
  const t = String(text || '');
  const found = TOPICS.filter(([, rx]) => rx.test(t));
  if (!found.length) {
    if (/вартіст|скільки\s+кошту|how\s+much|cost|fees?/iu.test(t)) return 'tuition';
    if (/документ|іспит|єві|єфвв|термін|строк|поданн\p{L}*\s+заяв/iu.test(t)) return 'admission';
    return null;
  }
  // Dormitory cost is not tuition; contact details for a dorm are housing-related.
  if (found.some(([topic]) => topic === 'housing')) return 'housing';
  if (found.some(([topic]) => topic === 'admission')) return 'admission';
  return found[0][0];
}
function explicitSubject(text) {
  return Boolean(detectLevel(text) || detectYear(text) || detectProgramme(text));
}
function previousUserTurns(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && m.role === 'user' && typeof m.content === 'string')
    .slice(-6).map(m => m.content.slice(0, 1200));
}
function rememberedContext(turns) {
  let state = { topic: null, level: null, programme: null, year: null };
  for (const t of turns) {
    if (EXPLICIT_NEW.test(t)) state = { topic: null, level: null, programme: null, year: null };
    const topic = classifyTopic(t);
    // Switching domains should not accidentally carry previous admissions
    // year, degree or programme into an unrelated dormitory/library question.
    if (topic && state.topic && topic !== state.topic && !['programme', 'tuition'].includes(topic)) {
      state = { topic, level: null, programme: null, year: null };
    } else if (topic) state.topic = topic;
    state.level = detectLevel(t) || state.level;
    state.programme = detectProgramme(t) || state.programme;
    state.year = detectYear(t) || state.year;
  }
  return state;
}

export function resolveDialogue(question, history = [], lang = 'uk') {
  const raw = String(question ?? '').trim().slice(0, 4000);
  const userTurns = previousUserTurns(history);
  const previous = rememberedContext(userTurns);
  const inferredTopic = classifyTopic(raw);
  const genericPrice = /(?:скільки\s+(?:це\s+)?кошту\p{L}*|яка\s+вартіст|how\s+much)/iu.test(raw)
    && !/навчан|tuition|контракт/iu.test(raw);
  const currTopic = previous.topic === 'housing' && genericPrice ? 'housing' : inferredTopic;
  const newTopic = Boolean(currTopic && previous.topic && currTopic !== previous.topic
    && !(previous.topic === 'admission' && ['tuition','programme'].includes(currTopic))
    && !(previous.topic === 'tuition' && currTopic === 'admission'));
  const hasHistory = userTurns.length > 0;
  const words = raw.split(/\s+/).filter(Boolean);
  const implicit = hasHistory && (FOLLOWUP.test(raw) || FILLER.test(raw) || words.length <= 3
    || /^(?:чи\s+є|скільки\s+|які\s+|де\s+|how\s+much|can\s+I)/iu.test(raw)
    || /\b(?:вона|вони|цього|таке|там|those|that|it)\b/iu.test(raw));
  const followUp = implicit && !EXPLICIT_NEW.test(raw);
  const mixedQuestion = /(?:\sі\s|\sта\s|а також|and)/iu.test(raw) && /(?:заочн|денн\p{L}*\s+форм|tuition|вартіст|кошту)/iu.test(raw);
  const inherit = followUp && (!newTopic || mixedQuestion);
  const level = detectLevel(raw) || (inherit ? previous.level : null);
  const programme = detectProgramme(raw) || (inherit ? previous.programme : null);
  const year = detectYear(raw) || (inherit ? previous.year : null);
  const topic = currTopic || (inherit ? previous.topic : null);
  // A topic such as "а скільки коштує?" after dormitory questions is a
  // housing follow-up, not a request for university tuition.
  const housingCost = inherit && previous.topic === 'housing' && /скільки\s+(?:це\s+)?кошту|вартіст|ціна|how\s+much/iu.test(raw)
    && !/навчан|tuition/iu.test(raw);
  const useEarlierTopic = inherit && (!inferredTopic || housingCost || (previous.topic === 'admission' && inferredTopic === 'tuition')); 
  const scope = [];
  if (useEarlierTopic || housingCost) {
    const labels = { housing:'гуртожитки та проживання', scholarship:'стипендії', academic_leave:'академічна відпустка', library:'бібліотека', rector:'ректор', schedule:'розклад занять', international:'міжнародні програми', admission:'вступ до університету', tuition:'вартість навчання', programme:'освітні програми' };
    scope.push(lang === 'en' ? (labels[previous.topic] || '') : (labels[previous.topic] || ''));
  }
  if (level && !detectLevel(raw)) scope.push(lang === 'en' ? EN_STUDY_LABEL[level] : STUDY_LABEL[level]);
  if (programme && !detectProgramme(raw)) scope.push(programme);
  if (year && !detectYear(raw) && (['admission', 'tuition', 'programme'].includes(topic) || mixedQuestion)) scope.push(`${year} рік`);
  // A follow-up that only asks for general requirements should inherit the
  // previous question's actionable subject (documents, exams, fees).
  const isGenericClarification = /^(?:(?:а\s+)?(?:цікавлять?\s+)?(?:загальні\s+умови|для\s+всіх|саме\s+загальні)|(?:саме\s+)?(?:для\s+магістр\p{L}*|для\s+бакалавр\p{L}*))\W*$/iu.test(raw);
  if (inherit && isGenericClarification && userTurns.length) {
    const last = userTurns.at(-1).replace(/\b20\d{2}\b/g, '').trim();
    scope.unshift(last.slice(0, 340));
  }
  const addScope = [...new Set(scope.filter(Boolean))].join(', ');
  // If the user changes only the year/degree/programme after a compound
  // answer, reuse the last substantive *user* question so no facet is lost.
  const onlyScopeChange = inherit && /^(?:(?:а|але|ні)[,\s]+)?(?:не\s+20\d{2}.*?20\d{2}|(?:на|у|в|для)\s+20\d{2}|(?:на|у|в|для)\s+(?:магістр|бакалавр|аспірант)|(?:для)\s+(?:економічн|комп)|20\d{2}\s+рік)/iu.test(raw);
  const substantive = onlyScopeChange ? [...userTurns].reverse().find(turn =>
    /(?:документ|випробуван|іспит|вартіст|скільки.*кошту|гуртожит|посел|стипенд|бібліоте|контакт|форма\s+навчан|зaочн|заочн|вступ)/iu.test(turn)
    && !EXPLICIT_NEW.test(turn)) : null;
  let searchQuestion = raw.replace(/не\s+20\d{2}\s*[,;]?\s*а\s+(20\d{2})/iu, '$1');
  if (substantive) {
    // Remove dates and old degree/programme markers from the prior wording;
    // the updated slot values are supplied exactly once via the scope below.
    const previousSubject = substantive.replace(/\b20\d{2}\b/g, ' ')
      .replace(/магістр\p{L}*|бакалавр\p{L}*|аспірант\p{L}*/giu, ' ')
      .replace(/\bF3\b|комп[’'`ʼ]?ютерн\p{L}*\s+наук|економічн\p{L}*\s+кібернет\p{L}*/giu, ' ')
      .replace(/\s+/g, ' ').trim();
    if (previousSubject) searchQuestion = `${previousSubject} — ${searchQuestion}`;
  }
  if (genericPrice && previous.topic === 'admission' && inherit && !/вартіст\s+навчан/iu.test(searchQuestion)) {
    searchQuestion += ' вартість навчання';
  }
  if (housingCost) searchQuestion = lang === 'en' ? `${raw} dormitory accommodation price` : `${raw} вартість проживання в гуртожитку`;
  if (addScope) searchQuestion = `${searchQuestion} — ${addScope}`;
  return { original: raw, searchQuestion, topic, level, programme, year, followUp, topicChanged: newTopic, historyUsed: Boolean(addScope), previousTopic: previous.topic };
}

export const __internalDialogue = { detectLevel, detectProgramme, detectYear, classifyTopic, previousUserTurns, rememberedContext };
