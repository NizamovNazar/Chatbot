import { buildExtractiveAnswer } from './quality.js';

// Детерміноване розбиття складених запитів: без LLM і без припущень про факти.
const INTENTS = [
  { id: 'eligibility', label: 'Можливість вступу з іншої спеціальності', en: 'Eligibility with a different bachelor degree',
    pattern: /(?:інш\p{L}*\s+спеціальн|диплом\p{L}*\s+бакалавр|можу\s+вступ|можна\s+вступ|different\s+(?:degree|major)|eligible)/iu,
    searches: ['правила вступу магістратура диплом бакалавра іншої спеціальності', 'умови прийому магістратура вступ на основі бакалавра'],
    evidence: /(?:інш\p{L}*\s+спеціальн|на\s+основі\s+(?:ступеня|диплома|освіти)|мають\s+право|допускаються|можуть\s+вступати|після\s+здобуття)/iu, preferred: /stati-magistrom\/dokumenti-ta-stroki|stati-magistrom\/pravila/i },
  { id: 'exams', label: 'Вступні випробування', en: 'Entrance examinations',
    pattern: /(?:випробуван|іспит|екзамен|єві|єфвв|entrance\s+exam|test\s+required)/iu,
    searches: ['магістратура вступні випробування ЄВІ ЄФВВ', 'правила прийому магістратура іспити тести'],
    evidence: /(?:вступн\p{L}*\s+випробуван|єві|єфвв|вступн\p{L}*\s+іспит|фахов\p{L}*\s+іспит)/iu, preferred: /stati-magistrom\/(jevi|kalendar-provedennya-eviefvv|efvv)/i },
  { id: 'documents', label: 'Документи для вступу', en: 'Application documents',
    pattern: /(?:документ|які\s+папери|пакет\s+документ|documents?\s+(?:to|for)|passport)/iu,
    searches: ['магістратура перелік документів для вступу', 'документи та строки прийому магістр'],
    evidence: /(?:документ|диплом|паспорт|копі\p{L}*|заяв\p{L}*|вступн\p{L}*\s+пакет)/iu, preferred: /stati-magistrom\/dokumenti-ta-stroki/i },
  { id: 'fees', label: 'Вартість навчання', en: 'Tuition fees',
    pattern: /(?:вартіст|скільки\s+кошту|оплат\p{L}*\s+навч|ціну\s+навч|tuition|fees?\s+for|how\s+much)/iu,
    searches: ['вартість навчання магістратура комп’ютерні науки', 'оплата за навчання магістр контракт'],
    evidence: /(?:вартіст|коштує|грн|оплат\p{L}*\s+за\s+навч|контракт)/iu, preferred: /stati-magistrom\/vartist-navchann/i },
  { id: 'deadlines', label: 'Строки та реєстрація', en: 'Application dates and deadlines',
    pattern: /(?:строк|термін|дедлайн|реєстраці|пода(?:ння|ти)\s+заяв|коли\s+пода|дати\s+вступ|deadline|registration\s+date)/iu,
    searches: ['магістратура строки реєстрації подання заяв', 'документи та строки вступу магістратура'],
    evidence: /(?:строк|термін|реєстрац|прийм\p{L}*\s+заяв|поданн\p{L}*\s+заяв|з\s+\d{1,2}\s+\p{L}+\s+до|до\s+\d{1,2}\s+\p{L}+)/iu, preferred: /stati-magistrom\/dokumenti-ta-stroki/i },
  { id: 'study_mode', label: 'Форми навчання', en: 'Study modes',
    pattern: /(?:заочн|дистанційн\p{L}*\s+форм|денн\p{L}*\s+форм|форми\s+навчання|part.time\s+study|full.time\s+study|study\s+mode)/iu,
    searches: ['форми навчання денна заочна магістратура', 'навчання форми освітні програми'],
    evidence: /(?:заочн|денн\p{L}*\s+форм|дистанційн|форми\s+навчання|навчання\s+за)/iu,
    preferred: /forma|navchannya|program/i },
  { id: 'housing', label: 'Гуртожитки та поселення', en: 'Dormitories and accommodation',
    pattern: /(?:гуртожит|посел|заселен|проживан|dorm|accommodat|housing)/iu,
    searches: ['гуртожитки студентів правила поселення Острозька академія', 'студентські гуртожитки адреси поселення'],
    evidence: /(?:гуртожит|поселен|проживан|заселен|студентськ\p{L}*\s+житл)/iu,
    preferred: /gurtozh|poselenn|housing/i },
  { id: 'scholarship', label: 'Стипендії', en: 'Scholarships',
    pattern: /(?:стипенд|scholarship|stipend)/iu,
    searches: ['стипендії студентів Острозька академія', 'порядок призначення стипендії'],
    evidence: /(?:стипенд|академічн\p{L}*\s+стипенд)/iu,
    preferred: /stypend|stipend/i },
  { id: 'academic_leave', label: 'Академічна відпустка', en: 'Academic leave',
    pattern: /(?:академічн\p{L}*\s+відпуст|academic\s+leave)/iu,
    searches: ['академічна відпустка порядок оформлення студент', 'умови академічної відпустки університет'],
    evidence: /(?:академічн\p{L}*\s+відпуст)/iu,
    preferred: /akadem|polohenn/i },
  { id: 'library', label: 'Бібліотека', en: 'Library',
    pattern: /(?:бібліоте(?:к|ц)|librar)/iu,
    searches: ['наукова бібліотека Острозька академія графік контакти', 'бібліотека послуги студентам'],
    evidence: /(?:бібліотек|книгозбірн|читальн\p{L}*\s+зал)/iu,
    preferred: /bibliotek|library/i },
  { id: 'rector', label: 'Ректорат', en: 'Rector office',
    pattern: /(?:ректор|rector)/iu,
    searches: ['ректор Острозької академії контакти ректорат', 'керівництво університету ректор'],
    evidence: /(?:ректор|ректорат)/iu,
    preferred: /rektor|rector|kerivnyctvo/i },
  { id: 'international', label: 'Міжнародні програми', en: 'International opportunities',
    pattern: /(?:erasmus|міжнародн\p{L}*\s+(?:обмін|програм|партнер|співпрац)|обмін\p{L}*\s+студент|international\s+(?:program|exchange))/iu,
    searches: ['міжнародні програми обміну для студентів Острозька академія', 'академічна мобільність Erasmus міжнародні зв’язки'],
    evidence: /(?:міжнародн|erasmus|мобільн|обмін\p{L}*\s+студент)/iu,
    preferred: /mizhnarod|international|erasmus|mobil/i },
  { id: 'contacts', label: 'Контакти приймальної комісії', en: 'Admissions contacts',
    pattern: /(?:контакт|телефон|адрес\p{L}*\s+комісі|приймальн\p{L}*\s+комісі|admissions\s+office)/iu,
    searches: ['контакти приймальної комісії Острозька академія', 'вступ контакти телефон'],
    evidence: /(?:приймальн\p{L}*\s+комісі|телефон|контакт|e-?mail|адрес)/iu, preferred: /kontakt/i },
];

export function planInformationNeeds(question, lang = 'uk') {
  const text = String(question || '');
  const found = INTENTS.filter(intent => intent.pattern.test(text));
  // Housing fees are not tuition fees; university admissions tests are not
  // students' lecture schedules. Avoid spurious unrelated intents.
  const housing = found.some(x => x.id === 'housing');
  const tuitionExplicit = /навчан|контракт|tuition|study\s+fee/iu.test(text);
  const scoped = found.filter(intent => {
    if (housing && intent.id === 'fees' && !tuitionExplicit) return false;
    return true;
  });
  // Explicit comparisons of education levels require two independent
  // retrievals. The phrase 'bachelor degree' as an admission prerequisite
  // alone does NOT activate comparison mode.
  const comparisons = /(?:бакалавр\p{L}*[^.!?]{0,35}(?:\sі\s|\sта\s|\sй\s|\sабо\s|\sand\s)магістр\p{L}*|магістр\p{L}*[^.!?]{0,35}(?:\sі\s|\sта\s|\sй\s|\sабо\s|\sand\s)бакалавр\p{L}*|bachelor[^.!?]{0,25}and\s+master|master[^.!?]{0,25}and\s+bachelor)/iu.test(text);
  const expanded = comparisons ? scoped.flatMap(intent => ['fees','documents','exams','study_mode','deadlines'].includes(intent.id)
    ? [{ ...intent, forcedLevel: 'бакалаврат', levelLabel: lang === 'en' ? 'bachelor degree' : 'бакалаврат' },
       { ...intent, forcedLevel: 'магістратура', levelLabel: lang === 'en' ? 'master degree' : 'магістратура' }] : [intent]) : scoped;
  return expanded.slice(0, 8).map(intent => {
    const decorated = { ...intent, title: (lang === 'en' ? intent.en : intent.label) + (intent.levelLabel ? ` — ${intent.levelLabel}` : '') };
    if (intent.id === 'contacts') {
      if (/ректор|rector/iu.test(text)) {
        decorated.title = lang === 'en' ? 'Rector office contacts' : 'Контакти ректорату';
        decorated.searches = ['контакти ректорат Острозька академія телефон', 'ректор офіційні контакти'];
        decorated.preferred = /rektor|rector|kontakt|kerivnyctvo/i;
      } else if (/бібліоте(?:к|ц)|librar/iu.test(text)) {
        decorated.title = lang === 'en' ? 'Library contacts' : 'Контакти бібліотеки';
        decorated.searches = ['наукова бібліотека контакти Острозька академія', 'бібліотека контакти телефон'];
        decorated.preferred = /bibliotek|library/i;
      } else if (/гуртожит|dorm/iu.test(text)) {
        decorated.title = lang === 'en' ? 'Dormitory contacts' : 'Контакти гуртожитків';
        decorated.searches = ['гуртожитки контакти поселення телефон', 'студентське містечко контакти'];
        decorated.preferred = /gurtozh|poselenn/i;
      }
    }
    return decorated;
  });
}

const stripQuote = s => String(s || '').replace(/^[«“]|[»”]$/g, '').trim();
const uniqueByUrl = (arr, max = 5) => {
  const seen = new Set();
  return arr.filter(s => { if (!s?.url || seen.has(s.url)) return false; seen.add(s.url); return true; }).slice(0, max);
};

/**
 * Не змішує різні питання. Знаходить витяг для КОЖНОЇ теми й відзначає
 * непідтверджені відомості. Цитата — не гарантія повноти відповіді.
 */
export function answerInformationNeeds(needs, originalQuestion, search, lang = 'uk') {
  const year = String(originalQuestion || '').match(/\b20\d{2}\b/)?.[0] || null;
  const master = /магістр|master/iu.test(originalQuestion);
  const bachelor = /бакалавр|bachelor/iu.test(originalQuestion) && !master;
  const phd = /аспірант|phd|doctoral/iu.test(originalQuestion) && !master && !bachelor;
  const level = master ? 'магістратура' : bachelor ? 'бакалаврат' : phd ? 'аспірантура' : '';
  const subject = /комп[’'`]?ютерн\p{L}*\s+наук|computer\s+science|\bF3\b/iu.test(originalQuestion) ? 'комп’ютерні науки' : '';
  const allSources = [], lines = [];
  let answered = 0, unanswered = 0;
  for (const need of needs) {
    let chosen = null, navigation = null, historic = null;
    const needLevel = need.forcedLevel || level;
    const originalQueries = [...need.searches];
    // Do not force all users into the master's admissions search index.
    const queries = needLevel === 'бакалаврат' ? originalQueries.map(q => q.replace(/магістр\p{L}*/giu, 'бакалаврат'))
      : needLevel === 'аспірантура' ? originalQueries.map(q => q.replace(/магістр\p{L}*/giu, 'аспірантура')) : originalQueries;
    if (needLevel) queries.unshift(`${need.label} ${needLevel} ${subject}`.trim());
    else if (subject) queries.unshift(`${need.label} ${subject}`.trim());
    for (const query of queries) {
      const docs = search(query) || [];
      if (!docs.length) continue;
      if (!navigation) navigation = docs.find(d => need.preferred?.test(d.url || '') && /^https:\/\//.test(d.url || '')) || null;
      const result = buildExtractiveAnswer(docs, query, lang);
      if (result.type !== 'extractive' || !result.sources.length) continue;
      const match = /«([\s\S]+?)»/.exec(result.answer);
      const excerpt = stripQuote(match?.[1] || '');
      if (!need.evidence.test(excerpt)) continue;
      // Source pages about a different degree cannot support a comparison
      // claim for the requested level, even with overlapping keywords.
      if (need.forcedLevel && result.sources[0]?.url) {
        const url = result.sources[0].url.toLowerCase();
        if (need.forcedLevel === 'бакалаврат' && /stati-magistrom|mahistr|magistr|master/.test(url)) continue;
        if (need.forcedLevel === 'магістратура' && /stati-bakalavr|bachelor|bakalavr/.test(url)) continue;
      }
      // Історичні вимоги не можна видавати за правила запитаного року.
      if (year && ['fees', 'deadlines', 'exams', 'documents', 'eligibility', 'study_mode'].includes(need.id)
        && !excerpt.includes(year)) {
        const oldYears = [...excerpt.matchAll(/\b20\d{2}\b/g)].map(x => x[0]).filter(y => Number(y) < Number(year));
        // Ціни без перевірки точної спеціальності не відтворюємо навіть історично.
        if (oldYears.length && need.id !== 'fees') {
          const oldYear = oldYears.sort().at(-1);
          if (!historic || Number(historic.year) < Number(oldYear))
            historic = { year: oldYear, excerpt: excerpt.slice(0, 320), source: result.sources[0] };
        }
        continue;
      }
      chosen = { excerpt: excerpt.slice(0, 350), source: result.sources[0] };
      break;
    }
    if (chosen) {
      answered++;
      allSources.push(chosen.source);
      const number = uniqueByUrl(allSources, 20).findIndex(s => s.url === chosen.source.url) + 1;
      lines.push(`${lines.length + 1}. ${need.title}: ${chosen.excerpt}${chosen.excerpt.length >= 350 ? '…' : ''} [${number}]`);
    } else {
      unanswered++;
      if (historic) {
        allSources.push(historic.source);
        const number = uniqueByUrl(allSources, 20).findIndex(x => x.url === historic.source.url) + 1;
        lines.push(`${lines.length + 1}. ${need.title}: ${lang === 'en' ? `Official material from ${historic.year} is available but cannot establish the rules for ${year}. Source [${number}]` : `Є матеріали за ${historic.year} рік, але вони не підтверджують правила ${year} року. Дивіться джерело [${number}]`}`);
        continue;
      }
      const yearText = year ? (lang === 'en' ? ` for ${year}` : ` на ${year} рік`) : '';
      if (navigation) allSources.push(navigation);
      const number = navigation ? uniqueByUrl(allSources, 20).findIndex(x => x.url === navigation.url) + 1 : null;
      const notice = lang === 'en' ? `Not confirmed in the available official university information${yearText}.` : `В офіційних матеріалах університету наразі немає підтверджених відомостей${yearText}.`;
      const link = navigation ? (lang === 'en' ? ` Related official page [${number}], check its publication year.` : ` Тематична офіційна сторінка [${number}] — перевірте її рік публікації.`) : '';
      lines.push(`${lines.length + 1}. ${need.title}: ${notice}${link}`);
    }
  }
  const header = lang === 'en'
    ? 'I checked each part of your question separately. Confirmed excerpts are shown where available; otherwise I link relevant official pages:'
    : 'Ось що вдалося встановити з офіційних джерел за кожною частиною вашого запитання:';
  const footer = unanswered
    ? (lang === 'en' ? 'For unanswered items, check the latest published admissions rules or contact the admissions office. Older rules must not be treated as the rules for the requested year.'
      : 'Для непідтверджених пунктів варто перевірити останні опубліковані правила прийому або звернутися до приймальної комісії. Правила попередніх років не можна автоматично переносити на запитаний рік.')
    : '';
  return { answer: [header, '', ...lines, '', footer].filter(Boolean).join('\n'),
    sources: uniqueByUrl(allSources, 12).map(s => ({ url: s.url, title: s.title })), answered, unanswered };
}
