// Deterministic metadata and quality checks. No LLM/API and no unsupported assertions.
import { createHash } from 'node:crypto';

export const MENU_PHRASES = [
  'рейтингові списки', 'списки рекомендованих', 'накази про зарахування',
  'студентське життя', 'військова кафедра', 'братство спудеїв',
  'панорамний тур', 'спортивні змагання', 'положення приймальної комісії',
  'правила прийому 2019', 'правила прийому 2020', 'правила прийому 2021',
  'правила прийому 2022', 'правила прийому 2023', 'правила прийому 2024',
  'правила прийому 2025', 'правила прийому 2026', 'освітні програми',
  'навігація', 'всі новини', 'архів новин', 'підготовчі курси',
];
const NORMALISE = s => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const yearMatches = text => [...String(text || '').matchAll(/\b20(?:1\d|2\d|3\d)\b/g)].map(x => Number(x[0]));

export function canonicalUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    // Tracking and page-display parameters should not create duplicate sources.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|yclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}
export function isOfficialSource(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'oa.edu.ua' || host.endsWith('.oa.edu.ua');
  } catch { return false; }
}
export function pageCategory(url, title = '') {
  const t = `${url || ''} ${title || ''}`.toLowerCase();
  if (/vartist|вартіст|кошту|tuition|oplat|оплат/.test(t)) return 'tuition';
  if (/dokumenti-ta-stroki|(?:vstup\.oa\.edu\.ua[^ ]*\/pravila)|правил\p{L}* прийому|документ\p{L}* для вступ|документ\p{L}* для участі|stroki-prijomu|строк\p{L}* прийому/iu.test(t)) return 'admission_rules';
  if (/jevi|efvv|vstupnih-viprobuvan|іспит|єві|єфвв|екзамен/i.test(t)) return 'admission_exams';
  if (/reitynh|rekom|nakazy|рейтингов|накази про зарахування/i.test(t)) return 'admission_results';
  if (/kontakti|contacts|контакт|телефон/.test(t)) return 'contacts';
  if (/gurtozh|info_students|гуртожит|dorm/i.test(t)) return 'dormitory';
  if (/rectorsoffice|ректор|rector/.test(t)) return 'leadership';
  if (/library|бібліотек/.test(t)) return 'library';
  if (/foreign|міжнародн|international|inozemc/i.test(t)) return 'international';
  if (/specialnosti|освітн\p{L}* програм|спеціальн/iu.test(t)) return 'study_programs';
  if (/history|історі/.test(t)) return 'history';
  if (/news|novin|новин|for_press/i.test(t)) return 'news';
  if (/vstup|abiturient|абітурієнт/i.test(t)) return 'admissions';
  return 'general';
}
export function studyLevel(url, title = '') {
  const source = `${url || ''} ${title || ''}`.toLowerCase();
  if (/stati-magistrom|\bмагістр\b|магiстр|магістратур|\bmasters?\b/.test(source)) return 'master';
  if (/stati-bakalavrom|\bбакалавр\b|\bbachelors?\b/.test(source)) return 'bachelor';
  if (/\baspirant|аспірант|\bphd\b|doctoral/.test(source)) return 'doctoral';
  return null;
}
export function getYearMetadata({ url, title, text = '' }) {
  const u = String(url || '').toLowerCase();
  const urlYear = u.match(/(?:enter[-_/]|pravyla?[-_/]|rules[-_/]|\b20)(20\d{2})/i)?.[1];
  const titleYears = yearMatches(title);
  const campaignYears = [...String(text || '').matchAll(/(?:вступна кампанія|правила прийому|вступ(?:у|ної кампанії)|вартість навчання)[^\n.!?]{0,70}?\b(20\d{2})\b/giu)].map(m=> Number(m[1]));
  const years = [...new Set([...titleYears, ...campaignYears, ...yearMatches(u.match(/(?:enter|rules|prijomu)[^/?#]*/i)?.[0] || '')])].sort((a,b)=>b-a).slice(0,12);
  let year = urlYear ? Number(urlYear) : null;
  if (!year && titleYears.length === 1) year = titleYears[0];
  if (!year && campaignYears.length === 1) year = campaignYears[0];
  if (year && !years.includes(year)) years.unshift(year);
  return { year, years };
}
export function inspectChunkText(text) {
  const s = NORMALISE(text);
  const matches = MENU_PHRASES.filter(word => s.toLowerCase().includes(word)).length;
  const words = s.split(/\s+/).filter(Boolean);
  const sentenceMarks = (s.match(/[.!?](?=\s|$)/g) || []).length;
  const menuLike = matches >= 4 && (sentenceMarks < 3 || matches / Math.max(5, words.length / 22) > 0.5);
  const startsMidWord = /^\p{Ll}/u.test(s) && !/^(і|й|та|або|як|а|в|у|на|від|до|за|що|для|про|це|не|але|при|де|коли|які|яка|який|хто|чи|після|якщо)\s/u.test(s);
  let quality = 1;
  if (s.length < 80) quality -= .4;
  if (menuLike) quality -= .65;
  if (matches >= 7) quality -= .2;
  if (startsMidWord) quality -= .12;
  if (s.length > 250 && sentenceMarks === 0) quality -= .2;
  return { quality: Math.max(0.06, Number(quality.toFixed(2))), menuLike, startsMidWord, menuHits: matches };
}
export function enrichDoc(doc) {
  if (!doc || typeof doc.chunk !== 'string') return null;
  const url = canonicalUrl(doc.url);
  if (!url || !isOfficialSource(url)) return null;
  const chunk = String(doc.chunk).trim();
  if (chunk.length < 28) return null;
  const title = NORMALISE(doc.title) || 'Без назви';
  const category = pageCategory(url, title);
  const level = studyLevel(url, title);
  const yearInfo = getYearMetadata({url,title,text:chunk});
  const check = inspectChunkText(chunk);
  // Only infer a programme from a programme-specific URL/title, never from a menu.
  const program = /kompyuterni-nauki|комп[’'`]?ютерн\p{L}* наук/iu.test(`${url} ${title}`) ? 'computer_science' : null;
  const fingerprint = createHash('sha1').update(chunk.replace(/\s+/g, ' ').toLowerCase()).digest('hex');
  return {...doc, url, title, chunk, category, level, program,
    year: yearInfo.year, years: yearInfo.years,
    quality: check.quality, menuLike: check.menuLike,
    fingerprint, schemaVersion: 4 };
}

export function cleanLegacyContent(text, title = '', url = '') {
  let s = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  // Refreshed admissions pages preserve line breaks. A long navigation menu
  // commonly precedes the actual page heading; remove that menu, not the body.
  if (/vstup\.oa\.edu\.ua/.test(url) && s.includes('\n')) {
    const leaf = String(title).split('|')[0].trim();
    const lines = s.split(/\n/).map(x=>x.trim()).filter(Boolean);
    const headingIndex = leaf.length > 3 ? lines.findLastIndex(line => line.toLowerCase() === leaf.toLowerCase()) : -1;
    if (headingIndex > 0) s = lines.slice(headingIndex).join('\n');
    else if (lines[0]?.toLowerCase() === 'навігація') {
      const firstContent = lines.findIndex((line,i) => i > 12 && /(?:контакт\p{L}*|вступна кампанія|правила прийому|приймальна комісія)/iu.test(line));
      if (firstContent > 0) s = lines.slice(firstContent).join('\n');
    }
  }
  // Reconstructed legacy 900-character fragments sometimes contain the entire
  // top navigation as one continuous paragraph. The page-specific heading is
  // immediately followed by the named study level on the admission site.
  if (/vstup\.oa\.edu\.ua/.test(url) && !s.includes('\n')) {
    const [leaf,level] = String(title).split('|').map(x=>x.trim());
    if (leaf && level && /^(магістр|бакалавр|аспірант)$/iu.test(level)) {
      const pair=`${leaf} ${level}`;
      const index=s.toLowerCase().lastIndexOf(pair.toLowerCase());
      if(index>90) s=s.slice(index);
    }
  }
  return s.split(/\n+/).map(x=>x.replace(/[ \t]{2,}/g, ' ').trim()).filter(Boolean).join('\n').trim();
}

export function mergeLegacyChunks(group) {
  const list = [...group].sort((a,b)=>(Number(a.id)||0)-(Number(b.id)||0));
  let output = '';
  for (const {chunk} of list) {
    const next = String(chunk || '').trim();
    if (!next) continue;
    if (!output) { output = next; continue; }
    const kmax = Math.min(250, output.length, next.length);
    let overlap = 0;
    for (let k = kmax; k >= 32; k--) if (output.endsWith(next.slice(0,k))) {overlap=k;break;}
    output += overlap ? next.slice(overlap) : `\n${next}`;
  }
  return cleanLegacyContent(output, list[0]?.title, list[0]?.url);
}
