import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import MiniSearch from 'minisearch';
import axios from 'axios';
import { crawlSite } from './crawl.js';
import { tokenize, overlapRatio, buildSystemPrompt } from './rag.js';

const PORT = Number(process.env.PORT || 5000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@oa.edu.ua';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin#2026';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase();
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
const MODEL_DAILY_LIMIT = Number(process.env.MODEL_DAILY_LIMIT || 1000);
const SCHEDULE_LOGIN_URL = process.env.SCHEDULE_LOGIN_URL || '';
const SCHEDULE_LOGIN_POST_URL = process.env.SCHEDULE_LOGIN_POST_URL || '';
const SCHEDULE_PAGE_URL = process.env.SCHEDULE_PAGE_URL || '';
const SCHEDULE_USER_FIELD = process.env.SCHEDULE_USER_FIELD || 'email';
const SCHEDULE_PASS_FIELD = process.env.SCHEDULE_PASS_FIELD || 'password';
const SCHEDULE_CSRF_FIELD = process.env.SCHEDULE_CSRF_FIELD || '_token';
const SCHEDULE_FORM_EXTRA = readJson(path.resolve('schedule_form_extra.json'), {});

const DATA_DIR = path.resolve('data');
const DOCS_PATH = path.join(DATA_DIR, 'docs.json');
const INDEX_PATH = path.join(DATA_DIR, 'docs_index.json');
const META_PATH = path.join(DATA_DIR, 'docs_meta.json');
const FAQ_PATH = path.join(DATA_DIR, 'faq.json');
const MOCK_SCHEDULE_PATH = path.join(DATA_DIR, 'mock_schedule.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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
  const fallback = buildDefaultMockSchedule();
  const loaded = readJson(MOCK_SCHEDULE_PATH, null);
  if (!loaded) {
    writeJson(MOCK_SCHEDULE_PATH, fallback);
    return fallback;
  }
  if (!Array.isArray(loaded.bells) || !Array.isArray(loaded.groups)) return fallback;
  return loaded;
}

function loadDocsIndex() {
  const docs = readJson(DOCS_PATH, []);
  const idxJson = readJson(INDEX_PATH, null);
  if (!idxJson) return { docsById: new Map(), mini: null };
  const mini = MiniSearch.loadJSON(typeof idxJson === 'string' ? idxJson : JSON.stringify(idxJson), {
    fields: ['chunk', 'title', 'url'],
    storeFields: ['chunk', 'title', 'url'],
    searchOptions: { prefix: true },
  });
  const docsById = new Map(docs.map((d) => [d.id, d]));
  return { docsById, mini };
}

function loadFaq() {
  return readJson(FAQ_PATH, {
    qas: [],
    chats: [],
    quick: [],
    quickByLang: { uk: [], en: [] },
    feedback: [],
    model: { calls: [], events: [], last_error: null, last_success_at: null, headers: {} },
  });
}

function saveFaq(data) {
  writeJson(FAQ_PATH, data);
}

function normalizeLang(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'uk';
}

ensureDataDir();
let mockSchedule = loadMockSchedule();
let { docsById, mini } = loadDocsIndex();
let faqData = loadFaq();
let faqNeedsSave = false;

if (!faqData.model) {
  faqData.model = { calls: [], events: [], last_error: null, last_success_at: null, headers: {} };
  faqNeedsSave = true;
}
if (!Array.isArray(faqData.feedback)) faqData.feedback = [];
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
if (faqNeedsSave) saveFaq(faqData);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let isReindexing = false;
let progress = { status: 'idle', indexed: 0, seen: 0, queued: 0, finishedAt: null };
let lastScheduleMinuteKey = '';
const scheduleSession = {
  authenticated: false,
  user: '',
  authMethod: '',
  cookies: {},
  lastLoginAt: null,
  lastError: null,
};

async function runReindex() {
  if (isReindexing) return;
  isReindexing = true;
  progress = { status: 'running', indexed: 0, seen: 0, queued: 0, finishedAt: null };
  try {
    await crawlSite({
      onProgress: (state) => {
        progress = { ...progress, ...state };
      },
    });
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

function checkScheduledReindex() {
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

  faqData.schedule.lastRunDate = todayKey;
  saveFaq(faqData);
  runReindex();
}

async function generateWithGroq(prompt, startedAt) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is missing');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Groq error: ${res.status}`);
  }

  faqData.model.last_success_at = new Date().toISOString();
  faqData.model.last_error = null;
  faqData.model.headers = {
    reqRemaining: res.headers.get('x-ratelimit-remaining-requests'),
    reqLimit: res.headers.get('x-ratelimit-limit-requests'),
  };
  faqData.model.calls.push(faqData.model.last_success_at);
  faqData.model.events.push({
    ts: faqData.model.last_success_at,
    status: 'ok',
    latencyMs: Math.max(0, Date.now() - startedAt),
  });
  // Keep last 5000 calls to avoid uncontrolled file growth
  if (faqData.model.calls.length > 5000) {
    faqData.model.calls = faqData.model.calls.slice(-5000);
  }
  if (faqData.model.events.length > 5000) {
    faqData.model.events = faqData.model.events.slice(-5000);
  }
  saveFaq(faqData);

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || 'Вибач, не вдалося отримати відповідь.';
}

function humanizeModelError(raw) {
  const text = String(raw || '');
  if (text.includes('GROQ_API_KEY is missing')) {
    return 'Ключ моделі не налаштовано. Перевір GROQ_API_KEY у .env.';
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
  if (text.includes('GROQ_API_KEY is missing')) return 'MISSING_KEY';
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

function hasLiveScheduleConfig() {
  return Boolean(SCHEDULE_LOGIN_URL && SCHEDULE_PAGE_URL);
}

function resetScheduleSession() {
  scheduleSession.authenticated = false;
  scheduleSession.user = '';
  scheduleSession.authMethod = '';
  scheduleSession.cookies = {};
  scheduleSession.lastLoginAt = null;
}

function cookieHeader(cookies) {
  const pairs = Object.entries(cookies || {}).filter(([, v]) => v !== '');
  return pairs.map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeSetCookieHeaders(cookies, setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of list) {
    const first = String(c || '').split(';')[0].trim();
    if (!first || !first.includes('=')) continue;
    const idx = first.indexOf('=');
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) continue;
    cookies[name] = value;
  }
}

function parseCookieHeader(raw) {
  const out = {};
  const parts = String(raw || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const name = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (!name) continue;
    out[name] = value;
  }
  return out;
}

async function requestWithCookies({ url, method = 'GET', data = undefined, headers = {}, cookies = {}, maxRedirects = 6 }) {
  let currentUrl = url;
  let currentMethod = method.toUpperCase();
  let currentData = data;
  let redirects = 0;

  while (true) {
    const requestHeaders = { ...headers };
    if (!requestHeaders['User-Agent']) {
      requestHeaders['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    }
    if (!requestHeaders.Accept) {
      requestHeaders.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
    if (!requestHeaders['Accept-Language']) {
      requestHeaders['Accept-Language'] = 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7';
    }
    const cHeader = cookieHeader(cookies);
    if (cHeader) requestHeaders.Cookie = cHeader;

    const res = await axios({
      url: currentUrl,
      method: currentMethod,
      data: currentData,
      headers: requestHeaders,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
    });

    mergeSetCookieHeaders(cookies, res.headers['set-cookie']);

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.location;
    if (!isRedirect || redirects >= maxRedirects) return res;

    redirects += 1;
    currentUrl = new URL(res.headers.location, currentUrl).toString();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod !== 'GET')) {
      currentMethod = 'GET';
      currentData = undefined;
      delete headers['Content-Type'];
    }
  }
}

function extractCsrf(html) {
  if (!html) return '';
  const tokenRegexes = [
    new RegExp(`<input[^>]*name=["']${SCHEDULE_CSRF_FIELD}["'][^>]*value=["']([^"']+)["']`, 'i'),
    /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const rgx of tokenRegexes) {
    const m = String(html).match(rgx);
    if (m?.[1]) return m[1];
  }
  return '';
}

function looksLikeLoginPage(html) {
  const t = String(html || '').toLowerCase();
  const hasGoogleLoginBanner =
    t.includes('увійдіть до системи за допомогою google') ||
    t.includes('увійти через google') ||
    t.includes('sign in with google') ||
    t.includes('/sign-in?from=%2fdashboard');
  const hasClassicPasswordForm = (t.includes('type="password"') || t.includes('name="password"')) && t.includes('name="email"');
  return hasGoogleLoginBanner || hasClassicPasswordForm;
}

function parseScheduleRowsFromHtml(html) {
  const text = String(html || '');
  if (!text.trim()) return [];

  const tableRows = [];
  const trMatches = text.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cellMatches = tr.match(/<(td|th)[^>]*>[\s\S]*?<\/(td|th)>/gi) || [];
    const cells = cellMatches
      .map((c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length >= 2) tableRows.push(cells.join(' | '));
  }
  if (tableRows.length) return tableRows.slice(0, 20);

  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length >= 8)
    .slice(0, 20);
}

async function loginToLiveSchedule(username, password) {
  if (!hasLiveScheduleConfig()) throw new Error('SCHEDULE_NOT_CONFIGURED');
  if (!username || !password) throw new Error('MISSING_CREDENTIALS');

  const cookies = {};
  const loginPageRes = await requestWithCookies({
    url: SCHEDULE_LOGIN_URL,
    method: 'GET',
    cookies,
  });
  if (loginPageRes.status >= 400) throw new Error(`LOGIN_PAGE_${loginPageRes.status}`);

  const csrf = extractCsrf(loginPageRes.data);
  const form = new URLSearchParams();
  form.set(SCHEDULE_USER_FIELD, username);
  form.set(SCHEDULE_PASS_FIELD, password);
  if (csrf) form.set(SCHEDULE_CSRF_FIELD, csrf);
  for (const [k, v] of Object.entries(SCHEDULE_FORM_EXTRA || {})) {
    form.set(String(k), String(v));
  }

  const loginRes = await requestWithCookies({
    url: SCHEDULE_LOGIN_POST_URL || SCHEDULE_LOGIN_URL,
    method: 'POST',
    data: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cookies,
  });
  if (loginRes.status >= 400) throw new Error(`LOGIN_FAILED_${loginRes.status}`);

  const scheduleRes = await requestWithCookies({
    url: SCHEDULE_PAGE_URL,
    method: 'GET',
    cookies,
  });
  if (scheduleRes.status >= 400) throw new Error(`SCHEDULE_PAGE_${scheduleRes.status}`);
  if (looksLikeLoginPage(scheduleRes.data)) throw new Error('LOGIN_REJECTED');

  scheduleSession.authenticated = true;
  scheduleSession.user = username;
  scheduleSession.authMethod = 'password';
  scheduleSession.cookies = { ...cookies };
  scheduleSession.lastLoginAt = new Date().toISOString();
  scheduleSession.lastError = null;
}

async function readLiveScheduleForChat(message, lang) {
  if (!scheduleSession.authenticated || !hasLiveScheduleConfig()) return null;

  const cookies = { ...scheduleSession.cookies };
  const scheduleRes = await requestWithCookies({
    url: SCHEDULE_PAGE_URL,
    method: 'GET',
    cookies,
  });
  if (scheduleRes.status >= 400) throw new Error(`LIVE_SCHEDULE_${scheduleRes.status}`);

  if (looksLikeLoginPage(scheduleRes.data)) {
    resetScheduleSession();
    scheduleSession.lastError =
      lang === 'en' ? 'Session expired. Please login to schedule again.' : 'Сесія розкладу завершилась. Увійди повторно.';
    return null;
  }

  scheduleSession.cookies = { ...cookies };

  const rows = parseScheduleRowsFromHtml(scheduleRes.data);
  if (!rows.length) {
    return lang === 'en'
      ? 'Authenticated schedule is connected, but data could not be parsed yet.'
      : 'Авторизований розклад підключено, але поки не вдалося коректно розібрати дані сторінки.';
  }

  const header =
    lang === 'en'
      ? 'Live schedule (authorized session):'
      : 'Реальний розклад (авторизована сесія):';

  const rangeWeek = /(тиж|week)/i.test(String(message || ''));
  const body = rows.slice(0, rangeWeek ? 18 : 12);
  return [header, ...body].join('\n');
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
  return /(розклад|дзвінк|занят|пар[аи]?|schedule|timetable|lesson|class|bells?)/i.test(String(text || ''));
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
      ? 'Mock API: bell schedule of Ostroh Academy:'
      : 'Мок API: розклад дзвінків Острозької академії:';
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
      ? `Mock API: no classes for group ${group.id} on ${dayLabel}.`
      : `Мок API: у групи ${group.id} немає занять на ${dayLabel}.`;
  }

  const header =
    lang === 'en'
      ? `Mock API schedule for group ${group.id} (${dayLabel}):`
      : `Мок API: розклад для групи ${group.id} (${dayLabel}):`;

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
      ? `Mock API weekly summary for ${group.id}:`
      : `Мок API: тижневий підсумок для ${group.id}:`;
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

  const group = extractGroup(message, schedule);
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

function searchAdminQaLocal(query, lang = 'uk') {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return null;
  let best = null;
  for (const qa of faqData.qas.filter((x) => x.enabled && normalizeLang(x.lang) === normalizeLang(lang))) {
    const ratio = overlapRatio(qTokens, qa.question || '');
    if (ratio >= 0.5 && (!best || ratio > best.ratio)) {
      best = { qa, ratio };
    }
  }
  return best ? best.qa : null;
}

function searchDocs(query, limit = 6) {
  if (!mini) return [];
  const results = mini.search(query, { prefix: true, fuzzy: 0.2 });
  const contexts = [];
  for (const r of results.slice(0, limit)) {
    const doc = docsById.get(r.id);
    if (doc) contexts.push(doc);
  }
  return contexts;
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true });
});

app.get('/api/schedule/status', async (req, res) => {
  res.json({
    ok: true,
    configured: hasLiveScheduleConfig(),
    authenticated: scheduleSession.authenticated,
    user: scheduleSession.user || null,
    authMethod: scheduleSession.authMethod || null,
    lastLoginAt: scheduleSession.lastLoginAt || null,
    lastError: scheduleSession.lastError || null,
    mode: scheduleSession.authenticated ? 'live' : 'mock',
  });
});

app.post('/api/schedule/login', async (req, res) => {
  const { adminEmail, adminPassword, username, password } = req.body || {};
  const ok = adminEmail === ADMIN_EMAIL && adminPassword === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ ok: false, error: 'admin_auth_failed' });

  try {
    await loginToLiveSchedule(String(username || '').trim(), String(password || '').trim());
    res.json({
      ok: true,
      configured: hasLiveScheduleConfig(),
      authenticated: scheduleSession.authenticated,
      user: scheduleSession.user || null,
      authMethod: scheduleSession.authMethod || null,
      lastLoginAt: scheduleSession.lastLoginAt || null,
      mode: 'live',
    });
  } catch (err) {
    const code = String(err?.message || '');
    scheduleSession.lastError =
      code === 'SCHEDULE_NOT_CONFIGURED'
        ? 'Не налаштовано URL розкладу. Заповни SCHEDULE_LOGIN_URL та SCHEDULE_PAGE_URL у .env'
        : code === 'MISSING_CREDENTIALS'
        ? 'Вкажи логін і пароль для входу в розклад'
        : code === 'LOGIN_REJECTED'
        ? 'Система використовує SSO/Google. Для цього режиму використовуй /api/schedule/session-cookies'
        : 'Не вдалося авторизуватися у системі розкладу';
    resetScheduleSession();
    return res.status(400).json({ ok: false, error: scheduleSession.lastError });
  }
});

app.post('/api/schedule/session-cookies', async (req, res) => {
  const { adminEmail, adminPassword, cookie, user } = req.body || {};
  const ok = adminEmail === ADMIN_EMAIL && adminPassword === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ ok: false, error: 'admin_auth_failed' });
  if (!hasLiveScheduleConfig()) {
    return res.status(400).json({
      ok: false,
      error: 'Не налаштовано URL розкладу. Заповни SCHEDULE_LOGIN_URL та SCHEDULE_PAGE_URL у .env',
    });
  }

  const cookies = parseCookieHeader(cookie);
  if (!Object.keys(cookies).length) {
    return res.status(400).json({ ok: false, error: 'Порожній cookie header' });
  }

  try {
    const resSchedule = await requestWithCookies({
      url: SCHEDULE_PAGE_URL,
      method: 'GET',
      cookies,
    });
    if (resSchedule.status >= 400) {
      return res.status(400).json({ ok: false, error: `Не вдалося відкрити сторінку розкладу (${resSchedule.status})` });
    }
    if (looksLikeLoginPage(resSchedule.data)) {
      return res.status(400).json({ ok: false, error: 'Cookie невалідний: система повернула сторінку входу' });
    }

    scheduleSession.authenticated = true;
    scheduleSession.user = String(user || 'browser_sso');
    scheduleSession.authMethod = 'cookie';
    scheduleSession.cookies = { ...cookies };
    scheduleSession.lastLoginAt = new Date().toISOString();
    scheduleSession.lastError = null;

    res.json({
      ok: true,
      authenticated: true,
      mode: 'live',
      authMethod: scheduleSession.authMethod,
      user: scheduleSession.user,
      lastLoginAt: scheduleSession.lastLoginAt,
    });
  } catch {
    resetScheduleSession();
    scheduleSession.lastError = 'Не вдалося застосувати cookie-сесію';
    res.status(500).json({ ok: false, error: scheduleSession.lastError });
  }
});

app.post('/api/schedule/logout', async (req, res) => {
  const { adminEmail, adminPassword } = req.body || {};
  const ok = adminEmail === ADMIN_EMAIL && adminPassword === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ ok: false, error: 'admin_auth_failed' });
  resetScheduleSession();
  scheduleSession.lastError = null;
  res.json({ ok: true, authenticated: false, mode: 'mock' });
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

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  const ok = email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
  res.json({ ok });
});

app.post('/api/admin/reindex', async (req, res) => {
  const { email, password } = req.body || {};
  const ok = email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ ok: false });
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
  faqData.schedule = {
    ...(faqData.schedule || {}),
    hour,
    minute,
  };
  saveFaq(faqData);
  res.json({ ok: true, hour, minute, time: `${formatTwo(hour)}:${formatTwo(minute)}` });
});

app.get('/api/admin/system-status', async (req, res) => {
  const meta = readJson(META_PATH, {});
  const docsIndexed = Number(meta.last_indexed_count || 0);
  const modelCallsToday = getModelCallsToday();
  const remainingFromHeader = Number(faqData.model.headers?.reqRemaining);
  const hasHeaderRemaining = Number.isFinite(remainingFromHeader);
  const remainingEstimate = Math.max(0, MODEL_DAILY_LIMIT - modelCallsToday);
  res.json({
    ok: true,
    chat: {
      healthy: docsIndexed > 0,
      message: docsIndexed > 0 ? 'Чат готовий до роботи' : 'Ще немає проіндексованих даних',
      docsIndexed,
      lastIndexedAt: meta.last_indexed_at || null,
    },
    model: {
      provider: AI_PROVIDER,
      name: GROQ_MODEL,
      configured: Boolean(GROQ_API_KEY),
      callsToday: modelCallsToday,
      remainingRequests: hasHeaderRemaining ? remainingFromHeader : remainingEstimate,
      remainingSource: hasHeaderRemaining ? 'header' : 'estimate',
      lastSuccessAt: faqData.model.last_success_at || null,
      lastError: faqData.model.last_error || null,
    },
    schedule: {
      configured: hasLiveScheduleConfig(),
      authenticated: scheduleSession.authenticated,
      user: scheduleSession.user || null,
      authMethod: scheduleSession.authMethod || null,
      mode: scheduleSession.authenticated ? 'live' : 'mock',
      lastLoginAt: scheduleSession.lastLoginAt || null,
      lastError: scheduleSession.lastError || null,
    },
    reindex: {
      running: isReindexing,
      indexed: progress.indexed,
      queued: progress.queued,
    },
  });
});

app.get('/api/admin/analytics', async (req, res) => {
  const meta = readJson(META_PATH, {});
  const chats = Array.isArray(faqData.chats) ? faqData.chats : [];
  const qas = Array.isArray(faqData.qas) ? faqData.qas : [];
  const events = Array.isArray(faqData.model?.events) ? faqData.model.events : [];
  const llmChats = chats.filter((c) => c?.meta?.sourceType === 'llm');
  const faqChats = chats.filter((c) => c?.meta?.sourceType === 'faq');
  const errorChats = chats.filter((c) => c?.meta?.sourceType === 'error');
  const noContextChats = llmChats.filter((c) => !c?.meta?.hadContext);
  const fallbackChats = llmChats.filter((c) => c?.meta?.fallback);

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
    const h = dt.getHours();
    const d = dt.toISOString().slice(0, 10);
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

  const chatsByTime = [...chats].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const sessionByChat = new WeakMap();
  let sessionId = 0;
  let prevSessionTs = 0;
  for (const c of chatsByTime) {
    const ts = new Date(c.created_at).getTime();
    if (!prevSessionTs || ts - prevSessionTs > 30 * 60 * 1000) sessionId += 1;
    prevSessionTs = ts;
    sessionByChat.set(c, sessionId);
  }

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

  const sortedChats = [...chats].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const sessions = [];
  let current = 0;
  let prevTs = 0;
  for (const c of sortedChats) {
    const ts = new Date(c.created_at).getTime();
    if (!prevTs || ts - prevTs > 30 * 60 * 1000) {
      if (current > 0) sessions.push(current);
      current = 1;
    } else {
      current += 1;
    }
    prevTs = ts;
  }
  if (current > 0) sessions.push(current);
  const avgSessionLength = sessions.length ? Number((sessions.reduce((a, b) => a + b, 0) / sessions.length).toFixed(2)) : 0;

  const docsIndexed = Number(meta.last_indexed_count || 0);
  const prevIndexed = Number(meta.prev_indexed_count || 0);

  res.json({
    ok: true,
    quality: {
      total: chats.length,
      noContext: noContextChats.length,
      fallback: fallbackChats.length,
      problematicTop: topProblematic,
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
      intents,
      topQuestions,
    },
    ops: {
      docsIndexed,
      docsDelta: docsIndexed - prevIndexed,
      lastIndexedAt: meta.last_indexed_at || null,
      indexDurationMs: Number(meta.last_index_duration_ms || 0),
      modelConfigured: Boolean(GROQ_API_KEY),
      reindexRunning: isReindexing,
    },
  });
});

app.post('/api/admin/analytics/reset', async (req, res) => {
  const { email, password } = req.body || {};
  const ok = email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ ok: false, error: 'Невірний логін або пароль' });
  try {
    faqData.chats = [];
    faqData.feedback = [];
    if (!faqData.model) faqData.model = {};
    faqData.model.events = [];
    faqData.model.last_error = null;
    faqData.model.last_success_at = null;
    saveFaq(faqData);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: 'Не вдалося скинути статистику' });
  }
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
  const { question, answer } = req.body || {};
  const lang = normalizeLang(req.body?.lang);
  const now = new Date().toISOString();
  faqData.qas.push({
    id: Date.now(),
    question,
    answer,
    lang,
    enabled: 1,
    updated_at: now,
  });
  saveFaq(faqData);
  res.json({ ok: true });
});

app.put('/api/admin/qa/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { question, answer, enabled } = req.body || {};
  const lang = normalizeLang(req.body?.lang);
  const now = new Date().toISOString();
  faqData.qas = faqData.qas.map((q) =>
    q.id === id ? { ...q, question, answer, lang, enabled: enabled ? 1 : 0, updated_at: now } : q
  );
  saveFaq(faqData);
  res.json({ ok: true });
});

app.delete('/api/admin/qa/:id', async (req, res) => {
  const id = Number(req.params.id);
  faqData.qas = faqData.qas.filter((q) => q.id !== id);
  saveFaq(faqData);
  res.json({ ok: true });
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
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ ok: false });
  faqData.quickByLang[lang] = items.map((x) => String(x));
  faqData.quick = faqData.quickByLang.uk || [];
  saveFaq(faqData);
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const requestStart = Date.now();
  try {
    const { message } = req.body || {};
    const lang = normalizeLang(req.body?.lang);
    if (!message || !message.trim()) return res.status(400).json({ error: 'Empty message' });

    if (isScheduleIntent(message)) {
      let scheduleAnswer = null;
      let sourceType = 'schedule_mock';
      try {
        scheduleAnswer = await readLiveScheduleForChat(message, lang);
        if (scheduleAnswer) sourceType = 'schedule_live';
      } catch {
        scheduleSession.lastError =
          lang === 'en'
            ? 'Failed to fetch live schedule, fallback to mock schedule is used.'
            : 'Не вдалося отримати реальний розклад, використано мок-розклад.';
      }

      if (!scheduleAnswer) {
        mockSchedule = loadMockSchedule();
        scheduleAnswer = buildMockScheduleAnswer(message, lang, mockSchedule);
      }

      if (scheduleAnswer) {
        faqData.chats.push({
          question: message,
          answer: scheduleAnswer,
          sources: sourceType === 'schedule_live' ? 'live_schedule' : 'mock_schedule',
          created_at: new Date().toISOString(),
          meta: {
            sourceType,
            contextsCount: 0,
            hadContext: false,
            fallback: false,
            lang,
            latencyMs: Math.max(0, Date.now() - requestStart),
          },
        });
        saveFaq(faqData);
        return res.json({ answer: scheduleAnswer, sources: [] });
      }
    }

    const adminQa = searchAdminQaLocal(message, lang);
    if (adminQa) {
      faqData.chats.push({
        question: message,
        answer: adminQa.answer,
        sources: 'admin_qa',
        created_at: new Date().toISOString(),
        meta: {
          sourceType: 'faq',
          contextsCount: 0,
          hadContext: false,
          fallback: false,
          faqQuestion: adminQa.question,
          lang,
          latencyMs: Math.max(0, Date.now() - requestStart),
        },
      });
      saveFaq(faqData);
      return res.json({ answer: adminQa.answer, sources: [] });
    }

    const contexts = searchDocs(message, 6);
    const systemPrompt = buildSystemPrompt(contexts, message, lang);

    let answer = '';
    if (AI_PROVIDER === 'groq') {
      const modelStart = Date.now();
      answer = await generateWithGroq(systemPrompt, modelStart);
    } else {
      return res.status(500).json({ error: 'Unsupported AI_PROVIDER' });
    }

    const lowerAnswer = String(answer || '').toLowerCase();
    const fallback =
      lowerAnswer.includes('не маю даних') ||
      lowerAnswer.includes('інформації недостатньо') ||
      lowerAnswer.includes('звернутися до адміністрації') ||
      lowerAnswer.includes("don't have enough data") ||
      lowerAnswer.includes('insufficient information') ||
      lowerAnswer.includes('contact administration');

    faqData.chats.push({
      question: message,
      answer,
      sources: JSON.stringify(contexts.map((c) => ({ url: c.url, title: c.title }))),
      created_at: new Date().toISOString(),
      meta: {
        sourceType: 'llm',
        contextsCount: contexts.length,
        hadContext: contexts.length > 0,
        fallback,
        lang,
        sources: contexts.map((c) => ({ url: c.url, title: c.title })),
        latencyMs: Math.max(0, Date.now() - requestStart),
      },
    });
    saveFaq(faqData);

    res.json({
      answer,
      sources: contexts.map((c) => ({ url: c.url, title: c.title })),
    });
  } catch (err) {
    const now = new Date().toISOString();
    const lang = normalizeLang(req.body?.lang);
    const humanError = humanizeModelError(err.message || err);
    faqData.model.last_error = humanError;
    faqData.model.events.push({
      ts: now,
      status: 'error',
      errorCode: extractModelErrorCode(err.message || err),
      latencyMs: Math.max(0, Date.now() - requestStart),
    });
    if (faqData.model.events.length > 5000) {
      faqData.model.events = faqData.model.events.slice(-5000);
    }
    faqData.chats.push({
      question: req.body?.message || '',
      answer: humanError,
      sources: 'error',
      created_at: now,
      meta: {
        sourceType: 'error',
        contextsCount: 0,
        hadContext: false,
        fallback: true,
        lang,
        latencyMs: Math.max(0, Date.now() - requestStart),
      },
    });
    saveFaq(faqData);
    res.status(500).json({ error: humanError });
  }
});

app.post('/api/chat/feedback', async (req, res) => {
  try {
    const { messageId, value, question, answer } = req.body || {};
    if (!messageId || !['up', 'down'].includes(value)) {
      return res.status(400).json({ ok: false, error: 'invalid_feedback' });
    }
    faqData.feedback.push({
      messageId: String(messageId),
      value,
      question: String(question || ''),
      answer: String(answer || ''),
      created_at: new Date().toISOString(),
    });
    if (faqData.feedback.length > 5000) faqData.feedback = faqData.feedback.slice(-5000);
    saveFaq(faqData);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: 'feedback_save_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

setInterval(checkScheduledReindex, 20 * 1000);
