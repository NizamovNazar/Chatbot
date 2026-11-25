const integer = (value) => Math.max(0, Number(value) || 0);
const fmt = (value) => new Intl.NumberFormat('uk-UA').format(integer(value));
const percent = (part, total) => total > 0 ? `${((100 * integer(part)) / total).toFixed(1).replace('.', ',')} %` : '—';
const safeDate = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) : 'Не вказано';
};
const privacyMask = (s) => String(s ?? '')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[електронна адреса]')
  .replace(/(?:\+?\d[\s().-]*){10,15}/g, '[номер телефону]')
  .trim().slice(0, 220);

export function academicReportData(report) {
  if (!report || typeof report !== 'object') throw new Error('Не вибрано звіт');
  const s = report.summary || {};
  const total = integer(s.totalRequests);
  const positive = integer(s.positiveFeedback);
  const negative = integer(s.negativeFeedback);
  const evaluated = positive + negative;
  const faq = integer(s.faqResponses);
  const model = integer(s.llmResponses);
  const errors = integer(s.errorResponses);
  const schedule = integer(s.scheduleResponses);
  const unique = integer(s.uniqueQuestions);
  const unresolved = Math.max(0, total - faq - model - errors - schedule);
  const sourceRows = [
    ['Автовідповіді (FAQ)', fmt(faq), percent(faq, total)],
    ['Відповіді мовної моделі', fmt(model), percent(model, total)],
    ['Розклад', fmt(schedule), percent(schedule, total)],
    ['Помилки', fmt(errors), percent(errors, total)],
    ['Інші / не класифіковано', fmt(unresolved), percent(unresolved, total)],
  ];
  const feedbackRows = [
    ['Позитивні оцінки', fmt(positive), percent(positive, evaluated)],
    ['Негативні оцінки', fmt(negative), percent(negative, evaluated)],
    ['Усього оцінок', fmt(evaluated), evaluated ? '100 %' : '—'],
  ];
  const questions = (Array.isArray(report.topQuestions) ? report.topQuestions : []).slice(0, 10)
    .map((x, i) => [String(i + 1), privacyMask(x.question) || '—', fmt(x.count)]);
  const intents = (Array.isArray(report.topIntents) ? report.topIntents : []).slice(0, 10)
    .map((x, i) => [String(i + 1), privacyMask(x.intent) || '—', fmt(x.count)]);
  const conclusion = total === 0
    ? 'У звітному періоді записів про звернення не виявлено. На підставі цієї вибірки неможливо оцінити роботу системи.'
    : `За звітний період зафіксовано такі показники: звернення — ${fmt(total)}, відповіді FAQ — ${fmt(faq)}, відповіді мовної моделі — ${fmt(model)}, помилки — ${fmt(errors)}. ${evaluated ? `Отримано користувацьких оцінок: ${fmt(evaluated)} (позитивні — ${fmt(positive)}, негативні — ${fmt(negative)}).` : 'Користувацькі оцінки відсутні.'} Ці показники описують використання системи, але не встановлюють фактичну правильність відповідей.`;
  return {
    title: 'ЗВІТ ПРО ФУНКЦІОНУВАННЯ ІНТЕЛЕКТУАЛЬНОГО ЧАТ-БОТА',
    institution: 'Національний університет «Острозька академія»',
    subtitle: 'OA Smart Assistant · аналітичний звіт за даними системи',
    type: report.type === 'monthly' ? 'Місячний' : 'Тижневий',
    period: String(report.periodLabel || [report.periodStart, report.periodEnd].filter(Boolean).join(' — ') || 'Не вказано'),
    generated: safeDate(report.createdAt),
    reportId: String(report.id || '—'),
    metrics: [
      ['Загальна кількість звернень', fmt(total)],
      ['Кількість унікальних формулювань', fmt(unique)],
      ['Частка автовідповідей FAQ', percent(faq, total)],
      ['Частка відповідей мовної моделі', percent(model, total)],
      ['Зафіксовані помилки', fmt(errors)],
      ['Отримані користувацькі оцінки', fmt(evaluated)],
    ],
    sourceRows, feedbackRows, questions, intents,
    conclusion,
    methodology: 'Звіт сформовано автоматично з журналів звернень, класифікації способу відповіді та добровільних відгуків користувачів за зазначений період. Один запис про звернення не обов’язково відповідає одному унікальному користувачу. Категорії тем визначені за евристичними правилами і можуть перетинатися за змістом.',
    limitations: 'Користувацькі оцінки відображають лише відповіді, які отримали відгук. Показник FAQ або наявність RAG-контексту не є доказом правильності відповіді. Цей операційний звіт не є експериментальним порівнянням мовних моделей. Тексти запитань маскуються за простими правилами для адрес електронної пошти й телефонів; перед зовнішнім поширенням потрібна перевірка персональних даних.',
  };
}

export function operationalReportText(report){const d=academicReportData(report);return [d.title,'Період: '+d.period,'Сформовано: '+d.generated,'',...d.metrics.map(([label,value])=>label+': '+value),'',d.conclusion,'',d.limitations].join('\n');}
