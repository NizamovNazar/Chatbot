export const STOP = new Set(['і', 'й', 'та', 'або', 'що', 'це', 'як', 'де', 'коли', 'чи', 'для', 'про', 'у', 'в', 'на', 'до', 'з', 'із', 'та', 'є']);

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOP.has(t));
}

export function overlapRatio(queryTokens, text) {
  const textTokens = new Set(tokenize(text));
  if (queryTokens.size === 0 || textTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of queryTokens) if (textTokens.has(t)) overlap += 1;
  return overlap / Math.max(1, queryTokens.size);
}

export function buildSystemPrompt(contexts, question, lang = 'uk') {
  const sourcesText = contexts
    .map((c, i) => `Джерело ${i + 1}: ${c.title || 'Без назви'}\nURL: ${c.url}\nТекст: ${c.chunk}`)
    .join('\n\n');

  if (String(lang).toLowerCase() === 'en') {
    return `You are the official assistant of Ostroh Academy.\n
Answer in English, clearly and briefly.\n
Use ONLY the source context below. If data is not enough, explicitly say you do not have enough data and suggest contacting administration or clarifying the request.\n
Context:\n${sourcesText}\n\nQuestion: ${question}`;
  }

  return `Ти — офіційний помічник Острозької академії.\n
Відповідай українською, ввічливо, чітко та по суті.\n
Використовуй ТІЛЬКИ контекст з джерел нижче. Якщо інформації недостатньо — скажи, що не маєш даних, і порадь звернутися до адміністрації або уточнити запит.\n
Контекст:\n${sourcesText}\n\nПитання: ${question}`;
}
