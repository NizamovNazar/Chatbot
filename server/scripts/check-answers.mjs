import fs from 'node:fs';
import path from 'node:path';

// Functional checks against real official facts and explicit expected behaviour.
// This is a small acceptance sample, not a population estimate of model accuracy.
const cases = [
  { id: 'greeting', question: 'Доброго дня!', expected: ['Вітаю'], kind: 'conversation' },
  { id: 'thanks', question: 'Дякую за допомогу', expected: ['Будь ласка'], kind: 'conversation' },
  { id: 'address', question: 'Де знаходиться Острозька академія?', expected: ['Острог', 'Семінарська', '35800'], source: '/ua/contacts', kind: 'fact' },
  { id: 'rector', question: 'Хто ректор університету?', expected: ['Едуард', 'Балашов'], source: 'rectorsoffice', kind: 'fact' },
  { id: 'institutes', question: 'Які факультети є в академії?', expected: ['лінгвістики', 'права', 'соціально-гуманітарного', 'міжнародних', 'інформаційних'], source: '/departments', kind: 'fact' },
  { id: 'founded', question: 'Коли заснували Острозьку академію?', expected: ['1576', 'Василь-Костянтин'], source: '/history', kind: 'fact' },
  { id: 'revived', question: 'Коли відродили університет?', expected: ['1994'], source: '/history', kind: 'fact' },
  { id: 'admissions-email', question: 'Яка електронна пошта приймальної комісії?', expected: ['vstup@oa.edu.ua'], source: '/contacts', kind: 'fact' },
  { id: 'tuition-clarification', question: 'Яка вартість навчання?', expected: ['бакалаврат', 'магістратура'], kind: 'clarification' },
  { id: 'schedule-no-group', question: 'Який розклад пар?', expected: ['якої групи'], kind: 'clarification' },
  { id: 'schedule-unknown-group', question: 'Розклад НЕВІДОМА-99 на понеділок', expected: ['якої групи'], forbidden: ['Історія України'], kind: 'clarification' },
  { id: 'schedule-demo', question: 'Розклад МУП-1 на понеділок', expected: ['Демонстраційні', 'МУП-1'], kind: 'demo' },
  { id: 'out-of-scope', question: 'Квантова телепортація нейтрино', expected: ['Не знайшов'], kind: 'no_context' },
  { id: 'address-paraphrase', question: 'На якій вулиці розташований університет?', expected: ['Семінарськ'], source: '/contacts', kind: 'generated' },
  { id: 'english-address', question: 'Where is Ostroh Academy located?', lang: 'en', expected: ['Ostroh'], source: '/contacts', kind: 'generated' },
  { id: 'library', question: 'Розкажи коротко про бібліотеку академії', expected: ['бібліотек'], source: 'library', kind: 'generated' },
  { id: 'partnership-routing', question: 'Розкажи про міжнародних партнерів університету', forbidden: ['Демонстраційні дані', 'МУП-1'], kind: 'generated' },
  { id: 'future-fee', question: 'Яка вартість магістратури з права у 2030 році?', expected: ['2030'], anyExpected: ['немає', 'не наведено', 'не містять', 'відсутн', 'нема', 'не маю', 'не вказан', 'не знайден', 'не знайдено', 'недостатньо', 'не зазначен'], kind: 'generated' },
  { id: 'admission-clarification', question: 'Які документи потрібні для вступу?', expected: ['бакалаврат', 'магістратуру'], kind: 'clarification' },
  { id: 'linguistics', question: 'Які мови можна вивчати в інституті лінгвістики?', expected: ['англій'], source: '/filologist', kind: 'generated' },
  { id: 'followup-email', question: 'А яка електронна пошта?', history: [{ role: 'user', content: 'Контакти приймальної комісії' }, { role: 'assistant', content: 'Уточніть, що саме вас цікавить.' }], expected: ['vstup@oa.edu.ua'], kind: 'generated' },
];
const base = process.env.TEST_API_BASE || 'http://localhost:5000';
const results = [];
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 150));
}
if (!ready) throw new Error('Backend is not ready; no answer checks were run.');
for (const c of cases) {
  const start = Date.now();
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: c.question, lang: c.lang || 'uk', history: c.history || [] }), signal: AbortSignal.timeout(40000),
    });
    const data = await res.json();
    const answer = String(data.answer || '');
    const issues = [];
    if (!res.ok) issues.push(`HTTP ${res.status}`);
    for (const term of c.expected || []) if (!answer.toLowerCase().includes(term.toLowerCase())) issues.push(`Expected: ${term}`);
    if (c.anyExpected && !c.anyExpected.some(term => answer.toLowerCase().includes(term))) issues.push('Expected explicit absence of future-year data');
    for (const term of c.forbidden || []) if (answer.includes(term)) issues.push(`Forbidden: ${term}`);
    if (c.source && !(data.sources || []).some(s => s.url.includes(c.source))) issues.push(`Expected source: ${c.source}`);
    results.push({ ...c, answer, sources: data.sources || [], sourceType: data.sourceType || 'llm', provider: data.provider || null, latencyMs: Date.now() - start, passed: issues.length === 0, issues });
  } catch (error) {
    results.push({ ...c, passed: false, issues: [error.name], latencyMs: Date.now() - start });
  }
  console.log(JSON.stringify({ id: c.id, passed: results.at(-1).passed, issues: results.at(-1).issues, provider: results.at(-1).provider, answer: results.at(-1).answer }));
}
const directory = path.resolve('../reports');
fs.mkdirSync(directory, { recursive: true });
const report = { testedAt: new Date().toISOString(), total: results.length, passed: results.filter(r => r.passed).length,
  method: 'Automated acceptance checks of expected facts, source URLs, clarification and routing. Semantic correctness and Ukrainian grammar require reading the saved answers. No baseline comparison. Not a general model accuracy estimate.', results };
fs.writeFileSync(path.join(directory, 'answer-checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, passed: report.passed, report: path.join(directory, 'answer-checks.json') }));
if (report.passed !== report.total) process.exitCode = 1;
