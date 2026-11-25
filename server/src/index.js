import {operationalReportText} from '../../shared/reportData.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import './config.js';
import express from 'express';
import { createKnowledgeSearch } from './knowledge.js';
import { buildSemanticIndex, writeSemanticIndex } from './semantic.js';
import { enrichDoc } from './knowledgeMetadata.js';
import { crawlSite } from './crawl.js';
import { createAiRouter } from './ai.js';
import { findFaq, cleanHistory, retrievalQuestion, conversationalReply, clarification, buildChatMessages, buildExtractiveAnswer } from './quality.js';
import { planInformationNeeds, answerInformationNeeds } from './multiIntent.js';
import { resolveDialogue } from './dialogue.js';
import { answerGroundedOffline } from './offlineEvidence.js';
import { corsGuard, fixedWindowLimit, envInteger, validatedQa, validatedQuickItems } from './security.js';
import { PostgresStore, isPostgresEnabled } from './postgresStore.js';
import { readJsonStrict, atomicJsonWrite, createDurableState } from './storage.js';
import { createAdminAuth, fileAuthStorage } from './adminAuth.js';
import {sourceRefs,sanitizeCitationMarkers} from './sources.js';
import {kyivDay,validDay,dayBounds} from '../../shared/time.mjs';
import {RESPONSE_TYPES,isNoContext,isFallback,validSessionId} from '../../shared/responseTypes.mjs';
import {createAiGuard} from './aiGuard.js';

const PORT = Number(process.env.PORT || 5000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const DATA_DIR = path.resolve('data');
const DOCS_PATH = path.join(DATA_DIR, 'docs.json');
const INDEX_PATH = path.join(DATA_DIR, 'docs_index.json');
const SEMANTIC_PATH = path.join(DATA_DIR, 'semantic_index.json');
const META_PATH = path.join(DATA_DIR, 'docs_meta.json');
const FAQ_PATH = path.join(DATA_DIR, 'faq.json');
const MOCK_SCHEDULE_PATH = path.join(DATA_DIR, 'mock_schedule.json');
const REPORTS_PATH = path.join(DATA_DIR, 'reports.json');
const POSTGRES_MODE = process.env.OA_TEST_SANDBOX !== '1' && isPostgresEnabled();
let postgres = null;
let sqlCache = null;
let lastKnowledgeCheck=0,knowledgeReload=null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  if(POSTGRES_MODE&&!sqlCache)return structuredClone(fallback);
  if (POSTGRES_MODE && sqlCache) {
    if (filePath === DOCS_PATH) return sqlCache.docs;
    if (filePath === SEMANTIC_PATH) return sqlCache.semanticIndex;
    if (filePath === META_PATH) return sqlCache.meta;
    if (filePath === path.join(DATA_DIR, 'source_refresh.json')) return sqlCache.sourceRefresh;
    if (filePath === MOCK_SCHEDULE_PATH) return sqlCache.mockSchedule;
  }
  return readJsonStrict(filePath, fallback);
}

function writeJson(filePath, data) {
  atomicJsonWrite(filePath, data);
}

function buildDefaultMockSchedule() {
  return {
    updated_at: '2026-02-20T00:00:00.000Z',
    timezone: 'Europe/Kyiv',
    bells: [
      { pair: 0, start: '07:20', end: '08:40' },
      { pair: 1, start: '09:00', end: '10:20' },
      { pair: 2, start: '10:40', end: '12:00' },
      { pair: 3, start: '12:30', end: '13:50' },
      { pair: 4, start: '14:10', end: '15:30' },
      { pair: 5, start: '15:40', end: '17:00' },
      { pair: 6, start: '17:10', end: '18:30' },
      { pair: 7, start: '18:40', end: '20:00' },
      { pair: 8, start: '20:10', end: '21:30' },
    ],
    groups: [
      {
        id: 'МУП-1',
        title: 'МУП-1',
        days: {
          mon: [
            { pair: 1, subject_uk: 'Історія України', subject_en: 'History of Ukraine', room: '301' },
            { pair: 3, subject_uk: 'Англійська мова', subject_en: 'English Language', room: '205' },
            { pair: 4, subject_uk: 'Соціальні комунікації', subject_en: 'Social Communications', room: '112' },
          ],
          tue: [
            { pair: 2, subject_uk: 'Політологія', subject_en: 'Political Science', room: '307' },
            { pair: 4, subject_uk: 'Журналістика', subject_en: 'Journalism', room: '118' },
            { pair: 5, subject_uk: 'Медіаправо', subject_en: 'Media Law', room: '221' },
          ],
          wed: [
            { pair: 1, subject_uk: 'Українська мова', subject_en: 'Ukrainian Language', room: '110' },
            { pair: 2, subject_uk: 'Філософія', subject_en: 'Philosophy', room: '303' },
            { pair: 6, subject_uk: 'Цифрові медіа', subject_en: 'Digital Media', room: '209' },
          ],
          thu: [
            { pair: 3, subject_uk: 'Копірайтинг', subject_en: 'Copywriting', room: '206' },
            { pair: 4, subject_uk: 'Маркетинг', subject_en: 'Marketing', room: '117' },
            { pair: 5, subject_uk: 'SMM-аналітика', subject_en: 'SMM Analytics', room: '315' },
          ],
          fri: [
            { pair: 1, subject_uk: 'Психологія', subject_en: 'Psychology', room: '308' },
            { pair: 2, subject_uk: 'Проєктний практикум', subject_en: 'Project Workshop', room: '201' },
            { pair: 4, subject_uk: 'Етика', subject_en: 'Ethics', room: '305' },
          ],
          sat: [],
          sun: [],
        },
      },
      {
        id: 'ПРАВО-2',
        title: 'ПРАВО-2',
        days: {
          mon: [
            { pair: 1, subject_uk: 'Конституційне право', subject_en: 'Constitutional Law', room: '401' },
            { pair: 2, subject_uk: 'Цивільне право', subject_en: 'Civil Law', room: '402' },
            { pair: 4, subject_uk: 'Юридична англійська', subject_en: 'Legal English', room: '205' },
          ],
          tue: [
            { pair: 1, subject_uk: 'Кримінальне право', subject_en: 'Criminal Law', room: '410' },
            { pair: 3, subject_uk: 'Міжнародне право', subject_en: 'International Law', room: '406' },
            { pair: 5, subject_uk: 'Судова риторика', subject_en: 'Court Rhetoric', room: '223' },
          ],
          wed: [
            { pair: 2, subject_uk: 'Теорія держави і права', subject_en: 'Theory of State and Law', room: '403' },
            { pair: 4, subject_uk: 'Фінансове право', subject_en: 'Financial Law', room: '408' },
            { pair: 6, subject_uk: 'Адміністративне право', subject_en: 'Administrative Law', room: '404' },
          ],
          thu: [
            { pair: 1, subject_uk: 'Екологічне право', subject_en: 'Environmental Law', room: '407' },
            { pair: 3, subject_uk: 'Трудове право', subject_en: 'Labor Law', room: '405' },
            { pair: 4, subject_uk: 'Юридична деонтологія', subject_en: 'Legal Deontology', room: '411' },
          ],
          fri: [
            { pair: 2, subject_uk: 'Господарське право', subject_en: 'Commercial Law', room: '409' },
            { pair: 3, subject_uk: 'Практика складання документів', subject_en: 'Legal Drafting Practice', room: '412' },
            { pair: 5, subject_uk: 'Права людини', subject_en: 'Human Rights', room: '413' },
          ],
          sat: [],
          sun: [],
        },
      },
    ],
  };
}

function loadMockSchedule() {
  if (POSTGRES_MODE && sqlCache) return sqlCache.mockSchedule;
  const fallback = buildDefaultMockSchedule();
  const loaded = readJson(MOCK_SCHEDULE_PATH, null);
  if (!loaded) {
    if (!POSTGRES_MODE) writeJson(MOCK_SCHEDULE_PATH, fallback);
    return fallback;
  }
  if (!Array.isArray(loaded.bells) || !Array.isArray(loaded.groups)) return fallback;
  return loaded;
}

function loadDocsIndex() {
  const docs = readJson(DOCS_PATH, []);
  if(!Array.isArray(docs))throw new Error('STORAGE_CORRUPT: docs.json must be an array.');
  const semanticIndex = readJson(SEMANTIC_PATH, null);
  return { docsById: new Map(docs.map(d => [d.id, d])), mini: createKnowledgeSearch(docs,{semanticIndex}) };
}

function loadFaq() {
  const value=readJson(FAQ_PATH, {
    qas: [],
    chats: [],
    quick: [],
    quickByLang: { uk: [], en: [] },
    feedback: [],
    model: { calls: [], events: [], last_error: null, last_success_at: null, headers: {} },
  });
  if(!value||typeof value!=='object'||Array.isArray(value)||['qas','chats','feedback'].some(k=>value[k]!==undefined&&!Array.isArray(value[k])))throw new Error('STORAGE_CORRUPT: invalid FAQ structure; original preserved.');
  return value;
}

function saveFaq(data) {
  if (POSTGRES_MODE) {
    if (!postgres) return Promise.reject(new Error('PostgreSQL is not initialized'));
    return postgres.saveFaq(data);
  }
  writeJson(FAQ_PATH, data);
  return Promise.resolve();
}

function loadReports() {
  const value=readJson(REPORTS_PATH, { weekly: [], monthly: [] });
  if(!value||typeof value!=='object'||Array.isArray(value)||['weekly','monthly'].some(k=>value[k]!==undefined&&!Array.isArray(value[k])))throw new Error('STORAGE_CORRUPT: invalid reports structure; original preserved.');
  return value;
}

function saveReports(data) {
  if (POSTGRES_MODE) {
    if (!postgres) return Promise.reject(new Error('PostgreSQL is not initialized'));
    return postgres.saveReports(data);
  }
  writeJson(REPORTS_PATH, data);
  return Promise.resolve();
}

function normalizeLang(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'uk';
}

ensureDataDir();
let mockSchedule = loadMockSchedule();
let { docsById, mini } = loadDocsIndex();
let faqData = loadFaq();
let reportsData = loadReports();
let faqNeedsSave = false;
let reportsNeedSave = false;

if (!faqData.model) {
  faqData.model = { calls: [], events: [], last_error: null, last_success_at: null, headers: {} };
  faqNeedsSave = true;
}
if (!Array.isArray(faqData.feedback)) { faqData.feedback = []; faqNeedsSave = true; }
if (!Array.isArray(faqData.model.calls)) faqData.model.calls = [];
if (!Array.isArray(faqData.model.events)) faqData.model.events = [];
if (!faqData.model.headers || typeof faqData.model.headers !== 'object') faqData.model.headers = {};
if (!Array.isArray(faqData.qas)) {
  faqData.qas = [];
  faqNeedsSave = true;
}
faqData.qas = faqData.qas.map((q) => ({ ...q, lang: normalizeLang(q?.lang) }));

if (!faqData.quickByLang || typeof faqData.quickByLang !== 'object') {
  faqData.quickByLang = { uk: [], en: [] };
  faqNeedsSave = true;
}
if (!Array.isArray(faqData.quickByLang.uk)) {
  faqData.quickByLang.uk = [];
  faqNeedsSave = true;
}
if (!Array.isArray(faqData.quickByLang.en)) {
  faqData.quickByLang.en = [];
  faqNeedsSave = true;
}
if (Array.isArray(faqData.quick) && faqData.quick.length && faqData.quickByLang.uk.length === 0) {
  faqData.quickByLang.uk = faqData.quick.map((x) => String(x));
  faqNeedsSave = true;
}
if (!faqData.schedule || typeof faqData.schedule !== 'object') {
  faqData.schedule = { hour: 2, minute: 0, lastRunDate: null };
  faqNeedsSave = true;
}
if (!Number.isInteger(faqData.schedule.hour)) faqData.schedule.hour = 2;
if (!Number.isInteger(faqData.schedule.minute)) faqData.schedule.minute = 0;
if (faqData.schedule.hour < 0 || faqData.schedule.hour > 23) faqData.schedule.hour = 2;
if (faqData.schedule.minute < 0 || faqData.schedule.minute > 59) faqData.schedule.minute = 0;
// Normalization stays in memory until an explicit successful mutation.
if (!reportsData || typeof reportsData !== 'object') {
  reportsData = { weekly: [], monthly: [] };
  reportsNeedSave = true;
}
if (!Array.isArray(reportsData.weekly)) {
  reportsData.weekly = [];
  reportsNeedSave = true;
}
if (!Array.isArray(reportsData.monthly)) {
  reportsData.monthly = [];
  reportsNeedSave = true;
}
const faqState=createDurableState(faqData,saveFaq,value=>{faqData=value;});
const reportState=createDurableState(reportsData,saveReports,value=>{reportsData=value;});
faqData=faqState.get();reportsData=reportState.get();
const updateFaq=change=>faqState.update(change);
const updateReports=change=>reportState.update(change);
const auth=createAdminAuth({env:process.env,storage:POSTGRES_MODE
  ? {update:change=>{if(!postgres)throw new Error('AUTH_STORAGE_UNAVAILABLE');return postgres.updateAuth(change);}}
  : fileAuthStorage(path.join(DATA_DIR,'admin_auth_v22.json'))});
if(process.env.NODE_ENV==='production'&&!POSTGRES_MODE&&process.env.OA_TEST_SANDBOX!=='1'&&process.env.AUTH_FILE_PERSISTENT!=='1')throw new Error('ADMIN_CONFIG: production requires PostgreSQL or AUTH_FILE_PERSISTENT=1 on a verified persistent volume.');
const aiGuard=createAiGuard({storage:POSTGRES_MODE?{update:change=>{if(!postgres)throw new Error('AI_STORAGE_UNAVAILABLE');return postgres.updateAuth(change,'ai_budget_v22');}}:fileAuthStorage(path.join(DATA_DIR,'ai_budget_v22.json')),maxConcurrent:envInteger(process.env.AI_MAX_CONCURRENT,2,1,20),dailyAttempts:envInteger(process.env.AI_DAILY_ATTEMPTS,40,1,100000)});

const app = express();
// Express 4 does not automatically forward rejected async handlers.
// Keep SQL persistence failures from becoming uncaught promise rejections.
for (const method of ['get','post','put','delete','patch']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => handlers.length === 0 ? original(route) : original(route, ...handlers.map(handler =>
    typeof handler === 'function' ? function asyncSafeRoute(req, res, next) {
      try { Promise.resolve(handler(req, res, next)).catch(next); }
      catch (error) { next(error); }
    } : handler));
}

// Enable only when hosted behind exactly one trusted reverse proxy (e.g. Render).
// Do not blindly trust forwarded IP headers on a directly exposed server.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(corsGuard({
  production: process.env.NODE_ENV === 'production',
  configuredOrigins: process.env.CORS_ORIGINS || '',
}));
app.use(express.json({ limit: '1mb' }));
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ok:false,error:'Завеликий запит.'});
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ok:false,error:'Некоректний JSON.'});
  }
  return next(error);
});
// Separate limits: protect admin credentials and external-model quotas, without
// restricting read-only knowledge/status endpoints. Defaults are configurable.
const loginLimiter = fixedWindowLimit({maxRequests:envInteger(process.env.LOGIN_REQUEST_MAX, 60, 1, 5000),windowMs:60*1000});
const chatLimiter = fixedWindowLimit({maxRequests:envInteger(process.env.CHAT_RATE_MAX, 40, 1, 5000),windowMs:10*60*1000});
const feedbackLimiter = fixedWindowLimit({maxRequests:envInteger(process.env.FEEDBACK_RATE_MAX, 30, 1, 1000),windowMs:10*60*1000});
app.use('/api/admin', (req, res, next) => {res.set('Cache-Control', 'no-store');next();});
app.post('/api/chat/feedback', feedbackLimiter);
app.post('/api/chat', chatLimiter);
app.post('/api/admin/login', loginLimiter);

// Адміністративна авторизація виконується на сервері, а не лише у React.
// Сесії зберігаються в пам'яті: після перезапуску сервера необхідний новий вхід.
function equalCredentials(actual, expected) {
  const a = Buffer.from(String(actual ?? ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ ok: false, error: 'admin_auth_required' });
  if (!auth.valid(match[1])) {
    return res.status(401).json({ ok: false, error: 'admin_session_expired' });
  }
  return next();
});


let isReindexing = false;
let progress = { status: 'idle', indexed: 0, seen: 0, queued: 0, finishedAt: null };
let lastScheduleMinuteKey = '';

async function runReindex() {
  if (isReindexing) return;
  isReindexing = true;
  progress = { status: 'running', indexed: 0, seen: 0, queued: 0, finishedAt: null };
  try {
    await crawlSite({
      onProgress: (state) => { progress = { ...progress, ...state }; },
    });
    // A successful crawl replaces SQL fragments/artifacts transactionally.
    // The crawler keeps JSON cache for compatibility with local rebuild tools.
    if (POSTGRES_MODE) {
      const fresh = await postgres.load();
      sqlCache = { ...sqlCache, docs: fresh.docs, meta:fresh.meta,
        semanticIndex:fresh.semanticIndex,sourceRefresh:fresh.sourceRefresh };
    }
    ({ docsById, mini } = loadDocsIndex());
  } catch (err) {
    console.log(`Reindex error: ${err.message}`);
  } finally {
    isReindexing = false;
    progress = { ...progress, status: 'idle' };
  }
}

function formatTwo(n) {
  return String(n).padStart(2, '0');
}

async function checkScheduledReindex() {
  if (process.env.OA_TEST_SANDBOX === '1') return;
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${formatTwo(now.getMonth() + 1)}-${formatTwo(now.getDate())}-${formatTwo(now.getHours())}-${formatTwo(now.getMinutes())}`;
  if (minuteKey === lastScheduleMinuteKey) return;
  lastScheduleMinuteKey = minuteKey;

  const hour = Number(faqData.schedule?.hour ?? 2);
  const minute = Number(faqData.schedule?.minute ?? 0);
  if (now.getHours() !== hour || now.getMinutes() !== minute) return;

  const todayKey = `${now.getFullYear()}-${formatTwo(now.getMonth() + 1)}-${formatTwo(now.getDate())}`;
  if (faqData.schedule?.lastRunDate === todayKey) return;
  if (isReindexing) return;

  try { await updateFaq(draft=>{draft.schedule.lastRunDate=todayKey;}); await runReindex(); }
  catch(error){console.error('Scheduled indexing persistence failed:', error.message);}
}

const aiRouter = createAiRouter(process.env, {
  beforeAttempt:()=>aiGuard.reserve(),
  async onAttempt(event) {
    await updateFaq(draft=>{
      draft.model.events.push(event);
      if(event.status==='ok')draft.model.calls.push(event.ts);
      draft.model.events=draft.model.events.slice(-5000);draft.model.calls=draft.model.calls.slice(-5000);
    });
  },
});
async function generateWithFallback(messages) {
  const result=await aiGuard.run(()=>aiRouter.generate(messages));
  await updateFaq(draft=>Object.assign(draft.model,{last_success_at:new Date().toISOString(),last_error:null,last_provider:result.provider,last_model:result.model}));
  return result;
}


function humanizeModelError(raw) {
  const text = String(raw || '');
  if(text.includes('AI_BUSY'))return 'Помічник обробляє інші запити. Спробуйте за кілька секунд.';
  if(text.includes('AI_BUDGET_EXHAUSTED'))return 'Добовий ліміт звернень до моделей вичерпано. Доступні локальні відповіді з офіційних джерел.';
  if (text.includes('AI_NOT_CONFIGURED')) {
    return 'ШІ-помічник ще не налаштовано. Спробуйте пізніше.';
  }
  if (text.includes('AI_UNAVAILABLE')) {
    return 'Моделі тимчасово недоступні або вичерпали квоту. Спробуйте пізніше.';
  }
  if (text.includes('429')) {
    return 'Перевищено ліміт запитів до моделі. Спробуй пізніше або зменши частоту запитів.';
  }
  if (text.includes('401') || text.includes('403')) {
    return 'Помилка доступу до моделі. Перевір API-ключ або права доступу.';
  }
  if (text.includes('fetch failed') || text.includes('ECONN') || text.includes('ENOTFOUND')) {
    return 'Немає з’єднання з сервісом моделі. Перевір інтернет або доступність API.';
  }
  return 'Модель тимчасово недоступна. Перевір журнал сервера.';
}

function extractModelErrorCode(raw) {
  const text = String(raw || '');
  if (text.includes('429')) return 'RATE_LIMIT';
  if (text.includes('401') || text.includes('403')) return 'AUTH';
  if (text.includes('fetch failed') || text.includes('ECONN') || text.includes('ENOTFOUND')) return 'NETWORK';
  if (text.includes('AI_NOT_CONFIGURED')) return 'MISSING_KEY';
  if (text.includes('AI_UNAVAILABLE')) return 'ALL_PROVIDERS_UNAVAILABLE';
  return 'UNKNOWN';
}

function getModelCallsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return (faqData.model.calls || []).filter((ts) => new Date(ts).getTime() >= startMs).length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function countBy(items) {
  const m = new Map();
  for (const item of items) m.set(item, (m.get(item) || 0) + 1);
  return m;
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES_UK = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Нд',
};
const DAY_NAMES_EN = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function normalizeGroupToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[–—−]/g, '-');
}

function isScheduleIntent(text) {
  const value = String(text || '');
  if (/(вступн|єві|єфвв|exam)/iu.test(value)) return false;
  return /(?:^|[^\p{L}])(?:розклад\p{L}*|дзвінк\p{L}*|занят\p{L}*|пар(?:а|и|у|і)?|schedules?|timetable|lessons?|classes|class|bells?)(?=$|[^\p{L}])/iu.test(value);
}

function isBellScheduleQuery(text) {
  return /(дзвінк|bell|time\s*table|час\s*занять)/i.test(String(text || ''));
}

function getDayCodeFromDate(date) {
  const idx = date.getDay(); // 0..6 (sun..sat)
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[idx] || 'mon';
}

function extractDayCode(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('післязавтра')) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return getDayCodeFromDate(d);
  }
  if (lower.includes('завтра') || lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getDayCodeFromDate(d);
  }
  if (lower.includes('сьогодні') || lower.includes('today')) {
    return getDayCodeFromDate(new Date());
  }

  const aliases = [
    ['mon', ['понеділ', 'пон', 'monday', 'mon']],
    ['tue', ['вівтор', 'вів', 'вт', 'tuesday', 'tue']],
    ['wed', ['серед', 'ср', 'wednesday', 'wed']],
    ['thu', ['четвер', 'чт', 'thursday', 'thu']],
    ['fri', ['пʼят', "п'ят", 'пят', 'пт', 'friday', 'fri']],
    ['sat', ['субот', 'сб', 'saturday', 'sat']],
    ['sun', ['неділ', 'нд', 'sunday', 'sun']],
  ];

  for (const [code, keys] of aliases) {
    if (keys.some((k) => lower.includes(k))) return code;
  }
  return null;
}

function parseDayQuery(value) {
  if (!value) return getDayCodeFromDate(new Date());
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) return getDayCodeFromDate(dt);
  }
  const lower = raw.toLowerCase();
  const fullMap = {
    mon: 'mon',
    monday: 'mon',
    tue: 'tue',
    tuesday: 'tue',
    wed: 'wed',
    wednesday: 'wed',
    thu: 'thu',
    thursday: 'thu',
    fri: 'fri',
    friday: 'fri',
    sat: 'sat',
    saturday: 'sat',
    sun: 'sun',
    sunday: 'sun',
    пн: 'mon',
    вт: 'tue',
    ср: 'wed',
    чт: 'thu',
    пт: 'fri',
    сб: 'sat',
    нд: 'sun',
  };
  if (fullMap[lower]) return fullMap[lower];
  return extractDayCode(lower) || getDayCodeFromDate(new Date());
}

function extractGroup(message, schedule, fallbackFirst = true) {
  const groups = Array.isArray(schedule?.groups) ? schedule.groups : [];
  const lower = normalizeGroupToken(message);
  for (const g of groups) {
    const id = normalizeGroupToken(g.id);
    const title = normalizeGroupToken(g.title);
    if ((id && lower.includes(id)) || (title && lower.includes(title))) return g;
  }
  return fallbackFirst ? groups[0] || null : null;
}

function getBellTime(pair, schedule) {
  const bells = Array.isArray(schedule?.bells) ? schedule.bells : [];
  const found = bells.find((b) => Number(b.pair) === Number(pair));
  if (!found) return '';
  return `${found.start}-${found.end}`;
}

function buildBellsAnswer(lang, schedule) {
  const bells = Array.isArray(schedule?.bells) ? schedule.bells : [];
  if (!bells.length) {
    return lang === 'en'
      ? 'Mock schedule is connected, but no bell schedule is configured yet.'
      : 'Мок-розклад підключено, але розклад дзвінків ще не налаштовано.';
  }
  const header =
    lang === 'en'
      ? 'Demo data: bell schedule of Ostroh Academy:'
      : 'Демонстраційні дані: розклад дзвінків Острозької академії:';
  const rows = bells.map((b) =>
    lang === 'en' ? `${b.pair} pair: ${b.start}-${b.end}` : `${b.pair} пара: ${b.start}-${b.end}`
  );
  return [header, ...rows].join('\n');
}

function buildScheduleDayAnswer(lang, group, dayCode, schedule) {
  if (!group) {
    return lang === 'en'
      ? 'No groups configured in mock schedule.'
      : 'У мок-розкладі не налаштовано жодної групи.';
  }

  const lessons = Array.isArray(group?.days?.[dayCode]) ? group.days[dayCode] : [];
  const dayLabel = (lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_UK)[dayCode] || dayCode;
  if (!lessons.length) {
    return lang === 'en'
      ? `Demo data: no classes for group ${group.id} on ${dayLabel}.`
      : `Демонстраційні дані: у групи ${group.id} немає занять на ${dayLabel}.`;
  }

  const header =
    lang === 'en'
      ? `Demo schedule for group ${group.id} (${dayLabel}):`
      : `Демонстраційні дані: розклад для групи ${group.id} (${dayLabel}):`;

  const rows = lessons.map((lesson) => {
    const time = lesson.time || getBellTime(lesson.pair, schedule);
    const subject = lang === 'en' ? lesson.subject_en || lesson.subject_uk : lesson.subject_uk || lesson.subject_en;
    const room = lesson.room ? (lang === 'en' ? `, room ${lesson.room}` : `, ауд. ${lesson.room}`) : '';
    if (lang === 'en') return `${lesson.pair} pair (${time}): ${subject}${room}`;
    return `${lesson.pair} пара (${time}): ${subject}${room}`;
  });
  return [header, ...rows].join('\n');
}

function buildScheduleWeekAnswer(lang, group) {
  if (!group) {
    return lang === 'en'
      ? 'No groups configured in mock schedule.'
      : 'У мок-розкладі не налаштовано жодної групи.';
  }
  const header =
    lang === 'en'
      ? `Demo weekly summary for ${group.id}:`
      : `Демонстраційні дані: тижневий підсумок для ${group.id}:`;
  const rows = DAY_ORDER.map((code) => {
    const cnt = Array.isArray(group?.days?.[code]) ? group.days[code].length : 0;
    const dayLabel = (lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_UK)[code];
    if (lang === 'en') return `${dayLabel}: ${cnt} classes`;
    return `${dayLabel}: ${cnt} занять`;
  });
  return [header, ...rows].join('\n');
}

function buildMockScheduleAnswer(message, lang, schedule) {
  if (!isScheduleIntent(message)) return null;
  const rangeWeek = /(тиж|week)/i.test(String(message || ''));
  if (isBellScheduleQuery(message)) return buildBellsAnswer(lang, schedule);

  const group = extractGroup(message, schedule, false);
  if (!group) {
    const groups = (schedule.groups || []).map(g => g.id).join(', ');
    return lang === 'en' ? `Which group do you need? The demonstration schedule contains: ${groups}.` : `Для якої групи показати розклад? У демонстраційних даних доступні: ${groups}.`;
  }
  if (rangeWeek) return buildScheduleWeekAnswer(lang, group);

  const dayCode = extractDayCode(message) || getDayCodeFromDate(new Date());
  return buildScheduleDayAnswer(lang, group, dayCode, schedule);
}

function classifyIntent(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('контакт') || t.includes('телефон') || t.includes('email')) return 'Контакти';
  if (t.includes('спеціаль') || t.includes('програм')) return 'Програми/спеціальності';
  if (t.includes('вступ') || t.includes('документ')) return 'Вступ';
  if (t.includes('розклад') || t.includes('schedule') || t.includes('timetable') || t.includes('дзвінк')) return 'Розклад';
  if (t.includes('ректор') || t.includes('декан')) return 'Керівництво';
  return 'Інше';
}

function startOfDay(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(dt) {
  const d = new Date(dt);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getWeekRange(reference = new Date()) {
  const now = startOfDay(reference);
  const day = now.getDay() || 7; // Mon=1..Sun=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfDay(monday), end: endOfDay(sunday) };
}

function getMonthRange(reference = new Date()) {
  const now = startOfDay(reference);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: startOfDay(start), end: endOfDay(end) };
}

function toIsoDate(dt) {
  return `${dt.getFullYear()}-${formatTwo(dt.getMonth() + 1)}-${formatTwo(dt.getDate())}`;
}

function buildReportRecord(type = 'weekly') {
  const now = new Date();
  const range = type === 'monthly' ? getMonthRange(now) : getWeekRange(now);
  const startTs = range.start.getTime();
  const endTs = range.end.getTime();

  const chats = (faqData.chats || []).filter((c) => {
    const ts = new Date(c.created_at || '').getTime();
    return Number.isFinite(ts) && ts >= startTs && ts <= endTs;
  });
  const feedback = (faqData.feedback || []).filter((f) => {
    const ts = new Date(f.created_at || '').getTime();
    return Number.isFinite(ts) && ts >= startTs && ts <= endTs;
  });

  const bySource = countBy(chats.map((c) => c?.meta?.sourceType || 'unknown'));
  const faqCount = bySource.get('faq') || 0;
  const llmCount = bySource.get('llm') || 0;
  const errorCount = bySource.get('error') || 0;
  const scheduleCount = (bySource.get('schedule_mock') || 0) + (bySource.get('schedule_live') || 0);
  const intentMap = countBy(chats.map((c) => classifyIntent(c.question)));
  const topQuestions = Array.from(
    countBy(chats.map((c) => String(c.question || '').trim()).filter(Boolean)).entries()
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));
  const topIntents = Array.from(intentMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([intent, count]) => ({ intent, count }));

  const positive = feedback.filter((x) => x.value === 'up').length;
  const negative = feedback.filter((x) => x.value === 'down').length;

  const periodLabel =
    type === 'monthly'
      ? `${formatTwo(range.start.getMonth() + 1)}.${range.start.getFullYear()}`
      : `${toIsoDate(range.start)} — ${toIsoDate(range.end)}`;


  const record = {
    id: `${type}-${Date.now()}`,
    type,
    periodStart: toIsoDate(range.start),
    periodEnd: toIsoDate(range.end),
    periodLabel,
    createdAt: new Date().toISOString(),
    summary: {
      totalRequests: chats.length,
      uniqueQuestions: new Set(chats.map((c) => String(c.question || '').trim()).filter(Boolean)).size,
      faqResponses: faqCount,
      llmResponses: llmCount,
      errorResponses: errorCount,
      scheduleResponses: scheduleCount,
      positiveFeedback: positive,
      negativeFeedback: negative,
    },
    topQuestions,
    topIntents,
    body: '',
  };
  record.body=operationalReportText(record);
  return record;
}

function searchAdminQaLocal(query, lang = 'uk') {
  return findFaq(query, faqData.qas, lang);
}

function searchDocs(query, limit = 6) {
  return mini ? mini.search(query, limit) : [];
}
async function refreshKnowledgeIfChanged(){
  if(knowledgeReload)return knowledgeReload;
  if(Date.now()-lastKnowledgeCheck<envInteger(process.env.KNOWLEDGE_CHECK_MS,5000,100,60000))return;
  knowledgeReload=(async()=>{
    if(POSTGRES_MODE){const revision=await postgres.knowledgeRevision();const old=sqlCache.meta?.knowledge_migrated_at||sqlCache.meta?.last_refresh_at||sqlCache.meta?.last_indexed_at||null;if(revision!==old){const fresh=await postgres.knowledgeState();sqlCache={...sqlCache,...fresh};({docsById,mini}=loadDocsIndex());}}
    else{const meta=readJson(META_PATH,{});const revision=meta.knowledge_migrated_at||meta.last_refresh_at||meta.last_indexed_at||null;if(revision!==cachedFileRevision){({docsById,mini}=loadDocsIndex());cachedFileRevision=revision;}}
    lastKnowledgeCheck=Date.now();
  })();try{await knowledgeReload;}finally{knowledgeReload=null;}
}
let cachedFileRevision=null;

async function replyLocally(res, question, answer, lang, sourceType,sessionId=null) {
  const responseId = randomUUID();
  await updateFaq(draft => {
draft.chats.push({ id: responseId, question, answer, sources: '[]', created_at: new Date().toISOString(),
    meta: { sourceType, lang,sessionId, contextsCount: 0, hadContext: false, fallback: sourceType === 'no_context',fallbackReason:sourceType==='no_context'?'no_evidence':null, latencyMs: 0 } });

});
  return res.json({ responseId, answer, sources: [], sourceType });
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, storage: POSTGRES_MODE ? 'postgresql' : 'json' });
});
app.get('/api/ready',async(req,res)=>{
  if(POSTGRES_MODE)await postgres.pool.query('SELECT 1');
  await refreshKnowledgeIfChanged();
  const ready=Boolean(auth.configured&&mini?.count>0);
  res.status(ready?200:503).json({ok:ready,version:22,storage:POSTGRES_MODE?'postgresql':'json',indexedFragments:mini?.count||0});
});

// Read-only proof of the active retrieval mode; no secrets or user data.
app.get('/api/knowledge/status', (req, res) => {
  res.json({ok:true,indexedFragments:mini?.count||0,
    searchMode:mini?.semanticEnabled?'hybrid_lsa_lexical':'lexical_page_chunk',
    semanticIndexActive:Boolean(mini?.semanticEnabled),
    semanticMethod:mini?.semanticMethod||null});
});

app.get('/api/schedule/status', async (req, res) => {
  res.json({
    ok: true,
    configured: true,
    authenticated: false,
    user: 'mock',
    authMethod: 'mock',
    lastLoginAt: null,
    lastError: null,
    mode: 'mock',
  });
});

app.get('/api/mock/schedule/groups', async (req, res) => {
  mockSchedule = loadMockSchedule();
  const groups = Array.isArray(mockSchedule?.groups)
    ? mockSchedule.groups.map((g) => ({ id: g.id, title: g.title || g.id }))
    : [];
  res.json({
    ok: true,
    mock: true,
    updatedAt: mockSchedule?.updated_at || null,
    groups,
  });
});

app.get('/api/mock/schedule/bells', async (req, res) => {
  mockSchedule = loadMockSchedule();
  res.json({
    ok: true,
    mock: true,
    updatedAt: mockSchedule?.updated_at || null,
    bells: Array.isArray(mockSchedule?.bells) ? mockSchedule.bells : [],
  });
});

app.get('/api/mock/schedule', async (req, res) => {
  mockSchedule = loadMockSchedule();
  const lang = normalizeLang(req.query?.lang);
  const range = String(req.query?.range || 'day').toLowerCase() === 'week' ? 'week' : 'day';
  const requestedGroup = String(req.query?.group || '').trim();
  const group = extractGroup(requestedGroup, mockSchedule, !requestedGroup);
  if (!group) {
    return res.status(404).json({
      ok: false,
      mock: true,
      error: lang === 'en' ? 'Group not found in mock schedule.' : 'Групу не знайдено у мок-розкладі.',
    });
  }

  if (range === 'week') {
    const week = DAY_ORDER.map((dayCode) => ({
      dayCode,
      dayLabel: (lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_UK)[dayCode],
      lessons: Array.isArray(group?.days?.[dayCode]) ? group.days[dayCode] : [],
    }));
    return res.json({
      ok: true,
      mock: true,
      range: 'week',
      updatedAt: mockSchedule?.updated_at || null,
      group: { id: group.id, title: group.title || group.id },
      week,
    });
  }

  const dayCode = parseDayQuery(req.query?.day);
  const lessons = Array.isArray(group?.days?.[dayCode]) ? group.days[dayCode] : [];
  res.json({
    ok: true,
    mock: true,
    range: 'day',
    updatedAt: mockSchedule?.updated_at || null,
    group: { id: group.id, title: group.title || group.id },
    dayCode,
    dayLabel: (lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_UK)[dayCode],
    bells: Array.isArray(mockSchedule?.bells) ? mockSchedule.bells : [],
    lessons,
  });
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body || {};
  const result=await auth.login(email,password,req.ip||req.socket.remoteAddress);
  if(result.retryAfter)res.set('Retry-After',String(result.retryAfter));
  return res.status(result.status).json({ok:result.status===200,...result});
});
app.post('/api/admin/logout',(req,res)=>{auth.logout((req.get('authorization')||'').slice(7));res.json({ok:true});});

app.post('/api/admin/reindex', async (req, res) => {
  if (isReindexing) return res.json({ ok: true, status: 'running' });
  runReindex();
  res.json({ ok: true, status: 'started' });
});

app.get('/api/admin/reindex/status', async (req, res) => {
  const meta = readJson(META_PATH, {});
  res.json({
    ok: true,
    status: progress.status,
    indexed: progress.indexed,
    seen: progress.seen,
    queued: progress.queued,
    lastIndexedAt: meta.last_indexed_at || null,
    lastIndexedCount: meta.last_indexed_count || null,
  });
});

app.get('/api/admin/reindex/schedule', async (req, res) => {
  const hour = Number(faqData.schedule?.hour ?? 2);
  const minute = Number(faqData.schedule?.minute ?? 0);
  res.json({
    ok: true,
    hour,
    minute,
    time: `${formatTwo(hour)}:${formatTwo(minute)}`,
    lastRunDate: faqData.schedule?.lastRunDate || null,
  });
});

app.put('/api/admin/reindex/schedule', async (req, res) => {
  const hour = Number(req.body?.hour);
  const minute = Number(req.body?.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return res.status(400).json({ ok: false, error: 'invalid_time' });
  }
await updateFaq(draft => {
  draft.schedule = {
    ...(draft.schedule || {}),
    hour,
    minute,
  };

});
  res.json({ ok: true, hour, minute, time: `${formatTwo(hour)}:${formatTwo(minute)}` });
});

app.get('/api/admin/system-status', async (req, res) => {
  const meta = readJson(META_PATH, {});
  const referenceRefresh = readJson(path.join(DATA_DIR, 'source_refresh.json'), {});
  const docsIndexed = Number(meta.last_indexed_count || 0);
  const modelCallsToday = getModelCallsToday();
  const routing = aiRouter.status();
  const active = routing.providers.find(p => p.id === routing.activeProvider) || routing.providers.find(p => p.state === 'ready');
  res.json({
    ok: true,
    chat: {
      healthy: docsIndexed > 0,
      message: docsIndexed > 0 ? 'Чат готовий до роботи' : 'Ще немає проіндексованих даних',
      docsIndexed,
      referencesUpdatedAt: referenceRefresh.refreshedAt || null,
      referencePages: referenceRefresh.refreshed?.length || 0,
      lastIndexedAt: meta.last_indexed_at || null,
    },
    model: {
      ...routing,
      provider: active?.id || routing.primary,
      name: active?.model || routing.providers[0]?.model,
      callsToday: modelCallsToday,
      remainingRequests: null,
      remainingSource: 'provider_dashboard',
      applicationGuard: aiGuard.status(),
      lastSuccessAt: faqData.model.last_success_at || null,
      lastError: faqData.model.last_error || null,
    },
    schedule: {
      configured: true,
      authenticated: false,
      user: 'mock',
      authMethod: 'mock',
      mode: 'mock',
      lastLoginAt: null,
      lastError: null,
    },
    reindex: {
      running: isReindexing,
      indexed: progress.indexed,
      queued: progress.queued,
    },
  });
});

// V18: searchable, server-paginated operational journal. Filter before pagination.
// The admin authentication middleware above protects this endpoint and CSV export.
app.get('/api/admin/analytics/explore', (req, res) => {
  const from=req.query.from||'',to=req.query.to||'';
  if((from&&!validDay(from))||(to&&!validDay(to)))return res.status(400).json({ok:false,error:'invalid_calendar_date'});
  const start=from?dayBounds(from).start:-Infinity,end=to?dayBounds(to).end:Infinity;
  if (from && to && from > to) return res.status(400).json({ ok: false, error: 'invalid_period' });
  const source = String(req.query.source || 'all');
  const lang = String(req.query.lang || 'all');
  const feedback = String(req.query.feedback || 'all');
  const q = String(req.query.q || '').trim().toLocaleLowerCase('uk-UA').slice(0, 160);
  if (!['all',...RESPONSE_TYPES].includes(source) ||
      !['all','uk','en'].includes(lang) || !['all','up','down','none'].includes(feedback)) {
    return res.status(400).json({ ok: false, error: 'invalid_filter' });
  }
  const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
  const pageSize = 25;
  const scores = new Map();
  for (const row of Array.isArray(faqData.feedback) ? faqData.feedback : []) {
    const id = row.responseId || row.response_id || row.messageId || row.message_id;
    if (id && (row.value === 'up' || row.value === 'down')) scores.set(String(id), row.value);
  }
  const filtered = (Array.isArray(faqData.chats) ? faqData.chats : []).filter((chat) => {
    const at = String(chat.created_at || '');
    const ts=new Date(at).getTime();
    if((from||to)&&(!Number.isFinite(ts)||ts<start||ts>=end))return false;
    const origin = String(chat.meta?.sourceType || 'unknown');
    if (source !== 'all' && source !== origin) return false;
    const language = chat.meta?.lang || chat.lang || (/[А-Яа-яІіЇїЄєҐґ]/.test(chat.question || '') ? 'uk' : 'en');
    if (lang !== 'all' && language !== lang) return false;
    const score = scores.get(String(chat.id || '')) || 'none';
    if (feedback !== 'all' && score !== feedback) return false;
    if (q && !`${chat.question || ''} ${chat.answer || ''}`.toLocaleLowerCase('uk-UA').includes(q)) return false;
    return true;
  }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const summary = { faq: 0, llm: 0, error: 0, negative: 0 };
  for (const chat of filtered) {
    const kind = chat.meta?.sourceType;
    if (kind in summary) summary[kind]++;
    if (scores.get(String(chat.id || '')) === 'down') summary.negative++;
  }
  const normalized = (chat) => ({
    id: chat.id || null, at: chat.created_at || null, question: String(chat.question || ''),
    answer: String(chat.answer || ''), source: String(chat.meta?.sourceType || 'unknown'),
    lang: chat.meta?.lang || chat.lang || (/[А-Яа-яІіЇїЄєҐґ]/.test(chat.question || '') ? 'uk' : 'en'),
    feedback: scores.get(String(chat.id || '')) || 'none',
  });
  if (req.query.format === 'csv') {
    const quote = (value) => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const columns = ['at', 'question', 'answer', 'source', 'lang', 'feedback'];
    const rows = [columns.map(quote).join(','), ...filtered.map((chat) => {
      const row = normalized(chat); return columns.map((field) => quote(row[field])).join(',');
    })];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="oa-analytics.csv"');
    return res.send('\uFEFF' + rows.join('\r\n'));
  }
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  res.json({ ok: true, total: filtered.length, summary, page: safePage, pages,
    pageSize, items: filtered.slice((safePage - 1) * pageSize, safePage * pageSize).map(normalized) });
});

app.get('/api/admin/analytics', async (req, res) => {
  const meta = readJson(META_PATH, {});
  const chats = Array.isArray(faqData.chats) ? faqData.chats : [];
  const qas = Array.isArray(faqData.qas) ? faqData.qas : [];
  const events = Array.isArray(faqData.model?.events) ? faqData.model.events : [];
  const llmChats = chats.filter((c) => c?.meta?.sourceType === 'llm');
  const faqChats = chats.filter((c) => c?.meta?.sourceType === 'faq');
  const errorChats = chats.filter((c) => c?.meta?.sourceType === 'error');
  const noContextChats = chats.filter(isNoContext);
  const fallbackChats = chats.filter(isFallback);

  const problemMap = countBy(
    chats
      .filter((c) => c?.meta?.sourceType === 'error' || c?.meta?.fallback || c?.meta?.hadContext === false)
      .map((c) => c.question)
  );
  const topProblematic = Array.from(problemMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));

  const feedbackAll = Array.isArray(faqData.feedback) ? faqData.feedback : [];
  const positiveFeedback = feedbackAll.filter((f) => f.value === 'up');
  const negativeFeedback = feedbackAll.filter((f) => f.value === 'down');
  const recentFeedback = feedbackAll
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const okEvents = events.filter((e) => e.status === 'ok');
  const errEvents = events.filter((e) => e.status === 'error');
  const latencies = okEvents.map((e) => Number(e.latencyMs || 0)).filter((x) => x > 0);
  const errorCodes = countBy(errEvents.map((e) => e.errorCode || 'UNKNOWN'));
  const topModelErrors = Array.from(errorCodes.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));

  const sourceHitMap = new Map();
  for (const c of llmChats) {
    const src = Array.isArray(c?.meta?.sources) ? c.meta.sources : [];
    for (const s of src) {
      const key = s.title || s.url || 'Без назви';
      sourceHitMap.set(key, (sourceHitMap.get(key) || 0) + 1);
    }
  }
  const topSources = Array.from(sourceHitMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  const faqHitMap = countBy(faqChats.map((c) => c?.meta?.faqQuestion).filter(Boolean));
  const topFaq = Array.from(faqHitMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));
  const unusedFaq = qas
    .filter((q) => q.enabled)
    .filter((q) => !faqHitMap.has(q.question))
    .slice(0, 20)
    .map((q) => ({ id: q.id, question: q.question }));

  const byHour = new Map();
  const byDay = new Map();
  for (const c of chats) {
    const dt = new Date(c.created_at);
    if(!Number.isFinite(dt.getTime()))continue;
    const h = dt.getHours();
    const d = kyivDay(dt);
    byHour.set(h, (byHour.get(h) || 0) + 1);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const requestsByHour = Array.from({ length: 24 }).map((_, h) => ({ hour: h, count: byHour.get(h) || 0 }));
  const requestsByDay = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([day, count]) => ({ day, count }));

  const isUaQuestion = (q) => /[А-Яа-яІіЇїЄєҐґ]/.test(String(q || ''));
  const isEnQuestion = (q) => !isUaQuestion(q) && /[A-Za-z]/.test(String(q || ''));
  const monthUa = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const weekDayUa = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  function toKeyDate(dt) {
    return `${dt.getFullYear()}-${formatTwo(dt.getMonth() + 1)}-${formatTwo(dt.getDate())}`;
  }

  function toKeyHour(dt) {
    return `${toKeyDate(dt)} ${formatTwo(dt.getHours())}`;
  }

  function toKeyMonth(dt) {
    return `${dt.getFullYear()}-${formatTwo(dt.getMonth() + 1)}`;
  }

  function toWeekKeyMonday(dtInput) {
    const dt = new Date(dtInput);
    dt.setHours(0, 0, 0, 0);
    const day = dt.getDay() || 7; // Mon=1 ... Sun=7
    dt.setDate(dt.getDate() - (day - 1));
    return toKeyDate(dt);
  }

  function addPoint(map, key, lang, sessionId) {
    if (!map.has(key)) {
      map.set(key, { uaReq: 0, enReq: 0, uaUsersSet: new Set(), enUsersSet: new Set() });
    }
    const p = map.get(key);
    if (lang === 'ua') {
      p.uaReq += 1;
      if (sessionId) p.uaUsersSet.add(sessionId);
    }
    if (lang === 'en') {
      p.enReq += 1;
      if (sessionId) p.enUsersSet.add(sessionId);
    }
  }

  function pointToJson(p) {
    return {
      uaReq: p?.uaReq || 0,
      enReq: p?.enReq || 0,
      uaUsers: p?.uaUsersSet?.size || 0,
      enUsers: p?.enUsersSet?.size || 0,
    };
  }

  const dayHoursMap = new Map(); // YYYY-MM-DD -> Map(hourKey -> {ua,en})
  const weekDaysMap = new Map(); // YYYY-MM-DD(monday) -> Map(dayKey -> {ua,en})
  const monthDaysMap = new Map(); // YYYY-MM -> Map(dayKey -> {ua,en})
  const yearMonthsMap = new Map(); // YYYY -> Map(monthKey -> {ua,en})

  const sessionByChat=new WeakMap();
  for(const c of chats)sessionByChat.set(c,validSessionId(c.meta?.sessionId||c.sessionId));

  for (const c of chats) {
    const dt = new Date(c.created_at);
    if (Number.isNaN(dt.getTime())) continue;
    const question = String(c.question || '');
    const lang = isUaQuestion(question) ? 'ua' : isEnQuestion(question) ? 'en' : null;
    if (!lang) continue;
    const sId = sessionByChat.get(c);

    const dayKey = toKeyDate(dt);
    const hourKey = toKeyHour(dt);
    const weekKey = toWeekKeyMonday(dt);
    const monthKey = toKeyMonth(dt);
    const yearKey = String(dt.getFullYear());

    if (!dayHoursMap.has(dayKey)) dayHoursMap.set(dayKey, new Map());
    addPoint(dayHoursMap.get(dayKey), hourKey, lang, sId);

    if (!weekDaysMap.has(weekKey)) weekDaysMap.set(weekKey, new Map());
    addPoint(weekDaysMap.get(weekKey), dayKey, lang, sId);

    if (!monthDaysMap.has(monthKey)) monthDaysMap.set(monthKey, new Map());
    addPoint(monthDaysMap.get(monthKey), dayKey, lang, sId);

    if (!yearMonthsMap.has(yearKey)) yearMonthsMap.set(yearKey, new Map());
    addPoint(yearMonthsMap.get(yearKey), monthKey, lang, sId);
  }

  function buildDailySeries(dayKey) {
    const byHourMap = dayHoursMap.get(dayKey) || new Map();
    return Array.from({ length: 24 }).map((_, hour) => {
      const key = `${dayKey} ${formatTwo(hour)}`;
      const v = pointToJson(byHourMap.get(key));
      return { label: `${formatTwo(hour)}:00`, ...v };
    });
  }

  function buildWeeklySeries(weekKey) {
    const byDayMap = weekDaysMap.get(weekKey) || new Map();
    const monday = new Date(`${weekKey}T00:00:00`);
    return Array.from({ length: 7 }).map((_, i) => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + i);
      const dayKey = toKeyDate(dt);
      const v = pointToJson(byDayMap.get(dayKey));
      return { label: weekDayUa[i], ...v };
    });
  }

  function buildMonthlySeries(monthKey) {
    const byDayMap = monthDaysMap.get(monthKey) || new Map();
    const [y, m] = monthKey.split('-').map(Number);
    const daysCount = new Date(y, m, 0).getDate();
    return Array.from({ length: daysCount }).map((_, i) => {
      const dayNum = i + 1;
      const dayKey = `${y}-${formatTwo(m)}-${formatTwo(dayNum)}`;
      const v = pointToJson(byDayMap.get(dayKey));
      return { label: String(dayNum), ...v };
    });
  }

  function buildYearlySeries(yearKey) {
    const byMonthMap = yearMonthsMap.get(yearKey) || new Map();
    return Array.from({ length: 12 }).map((_, i) => {
      const monthNum = i + 1;
      const monthKey = `${yearKey}-${formatTwo(monthNum)}`;
      const v = pointToJson(byMonthMap.get(monthKey));
      return { label: monthUa[i], ...v };
    });
  }

  const dayOptions = Array.from(dayHoursMap.keys()).sort((a, b) => a.localeCompare(b));
  const weekOptions = Array.from(weekDaysMap.keys()).sort((a, b) => a.localeCompare(b));
  const monthOptions = Array.from(monthDaysMap.keys()).sort((a, b) => a.localeCompare(b));
  const yearOptions = Array.from(yearMonthsMap.keys()).sort((a, b) => Number(a) - Number(b));

  const defaultDay = dayOptions[dayOptions.length - 1] || toKeyDate(new Date());
  const defaultWeek = weekOptions[weekOptions.length - 1] || toWeekKeyMonday(new Date());
  const defaultMonth = monthOptions[monthOptions.length - 1] || toKeyMonth(new Date());
  const defaultYear = yearOptions[yearOptions.length - 1] || String(new Date().getFullYear());

  const byLanguageRange = {
    daily: buildDailySeries(defaultDay),
    weekly: buildWeeklySeries(defaultWeek),
    monthly: buildMonthlySeries(defaultMonth),
    yearly: buildYearlySeries(defaultYear),
  };

  const byLanguageSelectable = {
    options: {
      daily: dayOptions,
      weekly: weekOptions,
      monthly: monthOptions,
      yearly: yearOptions,
    },
    defaults: {
      daily: defaultDay,
      weekly: defaultWeek,
      monthly: defaultMonth,
      yearly: defaultYear,
    },
    series: {
      daily: Object.fromEntries(dayOptions.map((k) => [k, buildDailySeries(k)])),
      weekly: Object.fromEntries(weekOptions.map((k) => [k, buildWeeklySeries(k)])),
      monthly: Object.fromEntries(monthOptions.map((k) => [k, buildMonthlySeries(k)])),
      yearly: Object.fromEntries(yearOptions.map((k) => [k, buildYearlySeries(k)])),
    },
  };

  const intentMap = countBy(chats.map((c) => classifyIntent(c.question)));
  const intents = Array.from(intentMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([intent, count]) => ({ intent, count }));
  const topQuestions = Array.from(
    countBy(
      chats
        .map((c) => String(c.question || '').trim())
        .filter(Boolean)
    ).entries()
  )
    .sort((a, b) => b[1] - a[1])
    .map(([question, count]) => ({ question, count }));

  const sessionSizes=new Map();let unknownSessionRequests=0;
  for(const c of chats){const id=validSessionId(c.meta?.sessionId||c.sessionId);if(id)sessionSizes.set(id,(sessionSizes.get(id)||0)+1);else unknownSessionRequests++;}
  const avgSessionLength=sessionSizes.size?Number(([...sessionSizes.values()].reduce((a,b)=>a+b,0)/sessionSizes.size).toFixed(2)):null;
  const docsIndexed = Number(meta.last_indexed_count || 0);
  const prevIndexed = Number(meta.prev_indexed_count || 0);

  res.json({
    ok: true,
    quality: {
      total: chats.length,
      noContext: noContextChats.length,
      fallback: fallbackChats.length,
      problematicTop: topProblematic,
      reviewedFaqHits: faqChats.filter(c => c?.meta?.reviewed === true).length,
      reviewQueue: {
        pending: feedbackAll.filter(f => f.status === 'pending').length,
        published: feedbackAll.filter(f => f.status === 'published').length,
        resolved: feedbackAll.filter(f => f.status === 'resolved').length,
      },
      feedback: {
        total: feedbackAll.length,
        positiveCount: positiveFeedback.length,
        negativeCount: negativeFeedback.length,
        recent: recentFeedback.slice(0, 50),
      },
    },
    model: {
      success: okEvents.length,
      errors: errEvents.length,
      errorRate: events.length ? Number(((errEvents.length / events.length) * 100).toFixed(2)) : 0,
      latencyP50: Math.round(percentile(latencies, 50)),
      latencyP95: Math.round(percentile(latencies, 95)),
      topErrors: topModelErrors,
    },
    rag: {
      avgContexts: llmChats.length
        ? Number((llmChats.reduce((acc, c) => acc + Number(c?.meta?.contextsCount || 0), 0) / llmChats.length).toFixed(2))
        : 0,
      emptySearches: noContextChats.slice(-20).map((c) => ({ question: c.question, at: c.created_at })),
      topSources,
    },
    faq: {
      faqResponses: faqChats.length,
      llmResponses: llmChats.length,
      errorResponses: errorChats.length,
      topFaq,
      unusedFaq,
    },
    behavior: {
      requestsByHour,
      requestsByDay,
      byLanguageRange,
      byLanguageSelectable,
      avgSessionLength,
      knownSessions:sessionSizes.size,unknownSessionRequests,sessionMetricCoverage:chats.length?(chats.length-unknownSessionRequests)/chats.length:0,
      intents,
      topQuestions,
    },
    ops: {
      docsIndexed,
      docsDelta: docsIndexed - prevIndexed,
      lastIndexedAt: meta.last_indexed_at || null,
      indexDurationMs: Number(meta.last_index_duration_ms || 0),
      modelConfigured: aiRouter.status().configured,
      reindexRunning: isReindexing,
    },
  });
});

app.post('/api/admin/analytics/reset', async (req, res) => {
  const { email, password } = req.body || {};
  const result = await auth.login(email,password,req.ip);
  if(result.status!==200){
    if(result.retryAfter)res.set('Retry-After',String(result.retryAfter));
    return res.status(result.status).json({ok:false,error:result.error,retryAfter:result.retryAfter});
  }
  auth.logout(result.token);
  await updateFaq(draft => {
    draft.chats = [];
    draft.feedback = [];
    if (!draft.model) draft.model = {};
    draft.model.events = [];
    draft.model.last_error = null;
    draft.model.last_success_at = null;
  });
  res.json({ ok: true });
});

app.get('/api/admin/stats', async (req, res) => {
  const total = faqData.chats.length;
  const last7 = faqData.chats.filter((c) => new Date(c.created_at) >= new Date(Date.now() - 7 * 86400000)).length;
  const counts = new Map();
  for (const c of faqData.chats) counts.set(c.question, (counts.get(c.question) || 0) + 1);
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([question, cnt]) => ({ question, cnt }));
  res.json({ total, last7, top });
});

app.get('/api/admin/reports', async (req, res) => {
  const type = String(req.query?.type || 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
  const list = (reportsData?.[type] || [])
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ ok: true, type, items: list });
});

app.post('/api/admin/reports/generate', async (req, res) => {
  const { type } = req.body || {};

  const normalizedType = String(type || 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
  const report = buildReportRecord(normalizedType);
await updateReports(draft => {
  if (!draft[normalizedType]) draft[normalizedType] = [];

  const duplicateIndex = draft[normalizedType].findIndex(
    (x) => x.periodStart === report.periodStart && x.periodEnd === report.periodEnd
  );
  if (duplicateIndex >= 0) {
    draft[normalizedType][duplicateIndex] = report;
  } else {
    draft[normalizedType].push(report);
  }

});
  res.json({ ok: true, item: report });
});

app.get('/api/admin/qa', async (req, res) => {
  const lang = normalizeLang(req.query?.lang);
  res.json(
    faqData.qas
      .filter((q) => normalizeLang(q.lang) === lang)
      .slice()
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  );
});

app.post('/api/admin/qa', async (req, res) => {
  const input = validatedQa(req.body);
  if (!input) return res.status(400).json({ok:false,error:'invalid_qa'});
  const { question, answer } = input;
  const lang = normalizeLang(req.body?.lang);
  const now = new Date().toISOString();
await updateFaq(draft => {
  draft.qas.push({
    id: Math.max(Date.now(),...draft.qas.map(q=>Number(q.id)||0))+1,
    question,
    answer,
    lang,
    enabled: 1,
    updated_at: now,
  });

});
  res.json({ ok: true });
});

app.put('/api/admin/qa/:id', async (req, res) => {
  const id = Number(req.params.id);
  const input = validatedQa(req.body, {allowEnabled:true});
  if (!Number.isSafeInteger(id) || id < 0 || !input) return res.status(400).json({ok:false,error:'invalid_qa'});
  const { question, answer } = input;
  const enabled = req.body?.enabled;
  if (!faqData.qas.some(q => q.id === id)) return res.status(404).json({ok:false,error:'qa_not_found'});
  const lang = normalizeLang(req.body?.lang);
  const now = new Date().toISOString();
await updateFaq(draft => {
  if(!draft.qas.some(q=>q.id===id))throw Object.assign(new Error('qa_not_found'),{status:404});
  draft.qas = draft.qas.map((q) =>
    q.id === id ? { ...q, question, answer, lang, enabled: enabled === undefined ? q.enabled : enabled ? 1 : 0, updated_at: now } : q
  );

});
  res.json({ ok: true });
});

app.delete('/api/admin/qa/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 0) return res.status(400).json({ok:false,error:'invalid_qa_id'});
  if (!faqData.qas.some(q => q.id === id)) return res.status(404).json({ok:false,error:'qa_not_found'});
await updateFaq(draft => {
  if(!draft.qas.some(q=>q.id===id))throw Object.assign(new Error('qa_not_found'),{status:404});
  draft.qas = draft.qas.filter((q) => q.id !== id);

});
  res.json({ ok: true });
});

// Публічна тільки ЧИТАННЯ добірка швидких питань. Зміна — лише /api/admin/quick з токеном.
app.get('/api/quick', (req, res) => {
  const lang = normalizeLang(req.query?.lang);
  const items = Array.isArray(faqData.quickByLang?.[lang]) ? faqData.quickByLang[lang] : [];
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, lang, items: items.filter(x => typeof x === 'string' && x.trim()) });
});

app.get('/api/admin/quick', async (req, res) => {
  const lang = normalizeLang(req.query?.lang);
  res.json(faqData.quickByLang?.[lang] || []);
});

app.get('/api/admin/quick/suggestions', async (req, res) => {
  const lang = normalizeLang(req.query?.lang);
  const quickSet = new Set((faqData.quickByLang?.[lang] || []).map((x) => String(x || '').trim().toLowerCase()));
  const counts = countBy(
    (faqData.chats || [])
      .filter((c) => normalizeLang(c?.meta?.lang) === lang)
      .map((c) => String(c.question || '').trim())
      .filter((q) => q.length >= 6)
  );

  const suggestions = Array.from(counts.entries())
    .map(([question, count]) => ({ question, count }))
    .filter((x) => !quickSet.has(x.question.toLowerCase()))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  res.json({ ok: true, items: suggestions });
});

app.put('/api/admin/quick', async (req, res) => {
  const lang = normalizeLang(req.body?.lang);
  const items = validatedQuickItems(req.body?.items);
  if (!items) return res.status(400).json({ ok: false, error:'invalid_quick_items' });
await updateFaq(draft => {
  draft.quickByLang[lang] = items;
  draft.quick = draft.quickByLang.uk || [];

});
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const requestStart = Date.now();
  const sessionId=validSessionId(req.body?.sessionId);
  try {
    const { message } = req.body || {};
    const lang = normalizeLang(req.body?.lang);
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) return res.status(400).json({ error: 'Запитання має містити від 1 до 4000 символів.' });
    await refreshKnowledgeIfChanged();
    const history = cleanHistory(req.body?.history);
    const dialogue = resolveDialogue(message, history, lang);
    const expandedQuestion = dialogue.searchQuestion;
    // Test-only forced AI branch: no FAQ/local fallback masquerades as a model response.
    // Enabled strictly in a loopback-bound isolated child process.
    if (process.env.OA_TEST_SANDBOX === '1' && req.body?.testMode === 'ai') {
      try {
        const contexts = searchDocs(expandedQuestion, 6);
        const messages = buildChatMessages(contexts, dialogue.followUp ? expandedQuestion : message, lang, history);
        const generated = await generateWithFallback(messages);
        if (!generated?.answer || !generated?.provider || generated.provider === 'local') {
          return res.status(503).json({ error: 'ШІ-провайдер не повернув відповіді.' });
        }
        return res.json({ answer: sanitizeCitationMarkers(generated.answer,contexts), sources: sourceRefs(contexts), sourceType: 'llm',
          provider: generated.provider, model: generated.model });
      } catch (error) {
        return res.status(503).json({ error: humanizeModelError(error.message || error) });
      }
    }
    const friendly = conversationalReply(message, lang);
    if (friendly) return await replyLocally(res, message, friendly, lang, 'conversation',sessionId);
    const followup = clarification(expandedQuestion, lang);
    if (followup) return await replyLocally(res, message, followup, lang, 'clarification',sessionId);

    if (isScheduleIntent(expandedQuestion)) {
      mockSchedule = loadMockSchedule();
      const scheduleAnswer = buildMockScheduleAnswer(expandedQuestion, lang, mockSchedule);
      if (scheduleAnswer) {
        const responseId = randomUUID();
        await updateFaq(draft => {
draft.chats.push({
          id: responseId,
          question: message,
          answer: scheduleAnswer,
          sources: 'mock_schedule',
          created_at: new Date().toISOString(),
          meta: {sessionId,
            sourceType: 'schedule_mock',
            contextsCount: 0,
            hadContext: false,
            fallback: false,
            lang,
            latencyMs: Math.max(0, Date.now() - requestStart),
          },
        });

});
        return res.json({ responseId, answer: scheduleAnswer, sources: [], sourceType: 'schedule_mock' });
      }
    }

    const adminQa = searchAdminQaLocal(dialogue.historyUsed ? expandedQuestion : message, lang);
    if (adminQa) {
      const responseId = randomUUID();
      await updateFaq(draft => {
draft.chats.push({
        id: responseId,
        question: message,
        answer: adminQa.answer,
        sources: 'admin_qa',
        created_at: new Date().toISOString(),
        meta: {sessionId,
          sourceType: 'faq',
          evidenceMode: 'curated',
          contextsCount: 0,
          hadContext: false,
          fallback: false,
          faqQuestion: adminQa.question,
          faqId: adminQa.id, reviewed: Boolean(adminQa.reviewed),
          lang,
          latencyMs: Math.max(0, Date.now() - requestStart),
        },
      });

});
      return res.json({ responseId, answer: adminQa.answer, sources: /^https:\/\//.test(adminQa.source_url || '') ? [{ url: adminQa.source_url, title: 'Офіційне джерело' }] : [], sourceType: 'faq' });
    }

    // Складений запит: кожну інформаційну потребу шукаємо незалежно.
    // Невідома ціна/рік не повинні зупиняти відповіді на інші питання.
    const needs = planInformationNeeds(expandedQuestion, lang);
    if (needs.length >= 2) {
      const composite = answerInformationNeeds(needs, expandedQuestion, (q) => searchDocs(q, 6), lang);
      const responseId = randomUUID();
      await updateFaq(draft => {
draft.chats.push({
        id: responseId, question: message, answer: composite.answer,
        sources: JSON.stringify(composite.sources), created_at: new Date().toISOString(),
        meta: {sessionId, sourceType: 'multi_extract', lang, contextsCount: composite.sources.length,
          hadContext: composite.sources.length > 0, fallback: composite.unanswered > 0,fallbackReason:composite.unanswered>0?'partial_evidence':null,
          answered: composite.answered, unanswered: composite.unanswered,
          latencyMs: Math.max(0, Date.now() - requestStart), sources: composite.sources },
      });

});
      return res.json({ responseId, answer: composite.answer, sources: composite.sources,
        sourceType: 'multi_extract', coveredNeeds: composite.answered, missingNeeds: composite.unanswered });
    }

    const contexts = searchDocs(expandedQuestion, 6);
    const verifiedOffline = answerGroundedOffline(expandedQuestion,lang,[...docsById.values()]);
    if (process.env.OA_TEST_SANDBOX === '1' && req.body?.testMode === 'offline' && verifiedOffline) {
      const result=verifiedOffline;
      const responseId=randomUUID();
      await updateFaq(draft => {
draft.chats.push({id:responseId,question:message,answer:result.answer,sources:JSON.stringify(result.sources),created_at:new Date().toISOString(),meta:{sessionId,sourceType:result.type,lang,sources:result.sources,fallbackReason:'retrieval_no_context'}});

});
      return res.json({responseId,answer:result.answer,sources:result.sources,sourceType:result.type});
    }
    if (!contexts.length && verifiedOffline) {
      const result=verifiedOffline;
      const responseId=randomUUID();
      await updateFaq(draft => {
draft.chats.push({id:responseId,question:message,answer:result.answer,sources:JSON.stringify(result.sources),created_at:new Date().toISOString(),meta:{sessionId,sourceType:result.type,lang,sources:result.sources,fallbackReason:'retrieval_no_context'}});

});
      return res.json({responseId,answer:result.answer,sources:result.sources,sourceType:result.type});
    }
    if (!contexts.length) {
      const answer = lang === 'en' ? 'I could not find reliable information about that in the academy’s sources. Could you clarify your question or specify the programme or department?' : 'Не знайшов підтвердженої інформації за цим запитом у доступних джерелах академії. Можна уточнити питання або перевірити відповідний розділ офіційного сайту.';
      return await replyLocally(res, message, answer, lang, 'no_context',sessionId);
    }
    const requestedYear = expandedQuestion.match(/\b20\d{2}\b/)?.[0];
    if (requestedYear && /вартіст|кошту|цін|tuition|cost|fee/i.test(expandedQuestion) && !contexts.some(c => c.chunk.includes(requestedYear))) {
      const answer = lang === 'en' ? `I could not find tuition fees for ${requestedYear} in the available official sources. Please check the admissions website for updates or specify another admission year.` : `В офіційній інформації, яку я знайшов, немає вартості навчання на ${requestedYear} рік. Можу допомогти знайти опубліковані умови вступу за інший рік або контакти приймальної комісії.`;
      return await replyLocally(res, message, answer, lang, 'clarification',sessionId);
    }
    const messages = buildChatMessages(contexts, dialogue.followUp ? expandedQuestion : message, lang, history);
    let generated;
    let modelError=null;
    let fallbackReason=null;
    try {
      generated = await generateWithFallback(messages);
    } catch (error) {
      if (!['AI_NOT_CONFIGURED', 'AI_UNAVAILABLE','AI_BUSY','AI_BUDGET_EXHAUSTED'].includes(error.code)) throw error;
      modelError = humanizeModelError(error.message);
      fallbackReason=error.code;
      const extracted = verifiedOffline || buildExtractiveAnswer(contexts, expandedQuestion, lang);
      generated = { answer: extracted.answer, provider: 'local', model: 'source-excerpt', sourceType: extracted.type, selectedContexts: extracted.sources };
    }
    if(!generated.sourceType||generated.sourceType==='llm')generated.answer=sanitizeCitationMarkers(generated.answer,contexts);
    const { answer, provider, model } = generated;
    const usedContexts = generated.selectedContexts || contexts;

    const fallback=Boolean(fallbackReason);

    const responseId = randomUUID();
    await updateFaq(draft => {
      if(modelError)draft.model.last_error=modelError;
draft.chats.push({
      id: responseId,
      question: message,
      answer,
      sources: JSON.stringify(sourceRefs(usedContexts)),
      created_at: new Date().toISOString(),
      meta: {sessionId,
        sourceType: generated.sourceType || 'llm',
        evidenceMode: generated.sourceType==='verified_local'?'extracted':undefined,
        provider,
        model,
        contextsCount: usedContexts.length,
        hadContext: usedContexts.length > 0,
        fallback,fallbackReason,
        lang,
        sources: sourceRefs(usedContexts),
        latencyMs: Math.max(0, Date.now() - requestStart),
      },
    });

});

    res.json({
      responseId,
      answer,
      provider,
      model,
      sourceType: generated.sourceType || 'llm',
      sources: sourceRefs(usedContexts),
    });
  } catch (err) {
    const now = new Date().toISOString();
    const lang = normalizeLang(req.body?.lang);
    const humanError = humanizeModelError(err.message || err);
    await updateFaq(draft => {
    draft.model.last_error = humanError;
    // Individual upstream failures are already recorded by the router.
    if (!['AI_NOT_CONFIGURED', 'AI_UNAVAILABLE'].includes(err.code)) draft.model.events.push({
      ts: now,
      status: 'error',
      errorCode: extractModelErrorCode(err.message || err),
      latencyMs: Math.max(0, Date.now() - requestStart),
    });
    if (draft.model.events.length > 5000) {
      draft.model.events = draft.model.events.slice(-5000);
    }

draft.chats.push({
      question: req.body?.message || '',
      answer: humanError,
      sources: 'error',
      created_at: now,
      meta: {sessionId,
        sourceType: 'error',
        contextsCount: 0,
        hadContext: false,
        fallback: true,
        lang,
        latencyMs: Math.max(0, Date.now() - requestStart),
      },
    });

});
    res.status(['AI_NOT_CONFIGURED', 'AI_UNAVAILABLE'].includes(err.code) ? 503 : 500).json({ error: humanError });
  }
});

// Оцінювання прив'язане до ЗБЕРЕЖЕНОЇ на сервері відповіді, а не до
// довільних question/answer, які міг би надіслати браузер.
app.post('/api/chat/feedback', async (req,res)=>{
 const {responseId,value,reason=''}=req.body||{};
 if(typeof responseId!=='string'||responseId.length>100||!['up','down'].includes(value)||typeof reason!=='string'||reason.length>800)return res.status(400).json({ok:false,error:'invalid_feedback'});
 await updateFaq(draft=>{
  const chat=draft.chats.find(c=>c.id===responseId);
  if(!chat?.question||!chat?.answer)throw Object.assign(new Error('unknown_answer'),{status:404});
  const old=draft.feedback.find(f=>f.responseId===responseId);
  if(old){if(old.status&&old.status!=='pending')throw Object.assign(new Error('already_reviewed'),{status:409});Object.assign(old,{value,reason,updated_at:new Date().toISOString()});}
  else draft.feedback.push({id:randomUUID(),responseId,messageId:responseId,value,reason,question:chat.question,answer:chat.answer,lang:normalizeLang(chat.meta?.lang),sourceType:chat.meta?.sourceType||'unknown',sources:chat.meta?.sources||[],status:'pending',created_at:new Date().toISOString()});
  if(draft.feedback.length>5000)draft.feedback=draft.feedback.slice(-5000);
 });res.json({ok:true,status:'pending'});
});

app.get('/api/admin/reviews', (req, res) => {
  const status = String(req.query.status || 'pending');
  const allowed = new Set(['all', 'pending', 'published', 'resolved', 'dismissed']);
  if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'invalid_status' });
  const items = faqData.feedback.filter(f => status === 'all' || (f.status || 'legacy') === status)
    .slice().sort((a,b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, 150);
  res.json({ ok: true, items,
    stats: { pending: faqData.feedback.filter(f => f.status === 'pending').length,
      published: faqData.feedback.filter(f => f.status === 'published').length,
      resolved: faqData.feedback.filter(f => f.status === 'resolved').length,
      dismissed: faqData.feedback.filter(f => f.status === 'dismissed').length } });
});

app.post('/api/admin/reviews/:id/action',async(req,res)=>{
 const action=String(req.body?.action||'');
 if(!['publish','resolve','dismiss'].includes(action))return res.status(400).json({ok:false,error:'invalid_action'});
 const result=await updateFaq(draft=>{
  const fail=(status,code)=>{throw Object.assign(new Error(code),{status});};
  const item=draft.feedback.find(f=>f.id===req.params.id);
  if(!item?.responseId)fail(404,'review_not_found');if(item.status!=='pending')fail(409,'already_processed');
  let faqId=null;
  if(action==='publish'){
   const question=String(req.body?.question||item.question||'').trim(),answer=String(req.body?.answer||'').trim(),sourceUrl=String(req.body?.sourceUrl||'').trim();
   if(question.length<7||question.length>500||answer.length<15||answer.length>5000||(sourceUrl&&!/^https:\/\//i.test(sourceUrl)))fail(400,'invalid_faq_content');
   const lang=normalizeLang(item.lang),norm=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
   if(draft.qas.some(q=>normalizeLang(q.lang)===lang&&norm(q.question)===norm(question)))fail(409,'faq_exists');
   faqId=Math.max(Date.now(),...draft.qas.map(q=>Number(q.id)||0))+1;
   draft.qas.push({id:faqId,question,answer,source_url:sourceUrl||null,lang,enabled:1,reviewed:true,evidenceMode:'curated',review_id:item.id,updated_at:new Date().toISOString()});
   if(req.body?.addToQuick===true){const quick=draft.quickByLang[lang]||[];if(!quick.some(q=>norm(q)===norm(question)))quick.push(question);draft.quickByLang[lang]=quick;draft.quick=draft.quickByLang.uk||[];}
  }
  Object.assign(item,{status:action==='publish'?'published':action==='resolve'?'resolved':'dismissed',reviewed_at:new Date().toISOString(),review_note:String(req.body?.note||'').trim().slice(0,1200),error_reason:String(req.body?.reason||'').trim().slice(0,100)});
  if(faqId!==null)item.faq_id=faqId;return {status:item.status,faqId};
 });res.json({ok:true,...result});
});

// Serve the compiled React frontend from the SAME HTTPS origin as the API.
// This is required for one-service deployment (e.g. a single Render web service).
// The built site contains public assets only; private server/data and .env are never exposed.
const WEB_DIST_DIR = process.env.OA_WEB_DIST_DIR
  ? path.resolve(process.env.OA_WEB_DIST_DIR)
  : fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (fs.existsSync(path.join(WEB_DIST_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIST_DIR, { dotfiles: 'deny', index: 'index.html' }));
  app.get('/admin', (req, res) => res.redirect(302, '/admin.html'));
}

app.use((error, req, res, next) => {
  console.error('[OA storage/request]', error?.code || error?.name || 'request_failure');
  if (!res.headersSent) res.status([400,404,409,429].includes(error?.status)?error.status:503).json({ok:false,error:[400,404,409,429].includes(error?.status)?error.message:'Помилка збереження даних або тимчасова недоступність сервера.'});
  else next(error);
});
async function main() {
  if (POSTGRES_MODE) {
    // No file fallback: wrong credentials or network failure MUST abort startup.
    const {store, state} = await PostgresStore.open(DATA_DIR);
    postgres = store;
    sqlCache = state;
    faqState.initialize(state.faq);
    reportState.initialize(state.reports);
    mockSchedule = state.mockSchedule && Array.isArray(state.mockSchedule.bells)
      ? state.mockSchedule : buildDefaultMockSchedule();
    sqlCache.mockSchedule = mockSchedule;
    ({ docsById, mini } = loadDocsIndex());
    console.log(`[OA PostgreSQL] Connected; imported=${store.imported}; indexed=${state.docs.length}; FAQ=${faqData.qas.length}; chats=${faqData.chats.length}`);
  }
  app.listen(PORT, process.env.OA_TEST_SANDBOX === '1' ? '127.0.0.1' : process.env.HOST||undefined, () => {
    console.log(`Server listening on http://localhost:${PORT}; storage=${POSTGRES_MODE?'postgresql':'json'}`);
  });
  setInterval(() => { checkScheduledReindex().catch(error => console.error('Schedule check:',error.message)); }, 20 * 1000);
}
main().catch(error => { console.error('[OA PostgreSQL startup FAILED]', error.message); process.exitCode=1; });
