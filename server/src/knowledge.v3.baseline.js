import MiniSearch from 'minisearch';
import { tokenize, normalizeTerm, queryTerms } from './quality.js';
export function createKnowledgeSearch(documents) {
  const fingerprints = new Set();
  const docs = documents.filter(d => {
    if (!d?.chunk || !/^https?:\/\//.test(d.url || '')) return false;
    const key = d.chunk.replace(/\s+/g, ' ').trim().toLowerCase();
    if (fingerprints.has(key)) return false;
    fingerprints.add(key);
    return true;
  });
  const byId = new Map(docs.map(d => [d.id, d]));
  function topics(doc) {
    const path = new URL(doc.url).pathname;
    const words = [];
    if (/contacts|kontakti/.test(path)) words.push('адреса контакт');
    if (/history/.test(path)) words.push('історія');
    if (/rectorsoffice/.test(path)) words.push('ректор');
    if (/departments\/?$/.test(path)) words.push('інститут');
    if (/foreign/.test(path)) words.push('міжнародний партнер');
    if (/library/.test(path)) words.push('бібліотека');
    if (/info_students/.test(path)) words.push('гуртожиток');
    if (/specialnosti/.test(path)) words.push('програма');
    if (/vartist-navchann(?:ya|ia)/.test(path)) words.push('вартість');
    if (/dokumenti-ta-stroki/.test(path)) words.push('документ вступ');
    if (/stati-magistrom/.test(path)) words.push('магістр');
    if (/stati-bakalavrom/.test(path)) words.push('бакалавр');
    if (/vstup\.oa\.edu\.ua/.test(doc.url) && path === '/') words.push('вступ');
    return words.join(' ');
  }
  const mini = new MiniSearch({ fields: ['title', 'chunk', 'topics'], tokenize, processTerm: normalizeTerm });
  mini.addAll(docs.map(d => ({ ...d, topics: topics(d) })));
  function search(question, limit = 6) {
    const terms = queryTerms(question);
    if (!terms.length) return [];
    // Відхиляємо документи іншого освітнього рівня, навіть якщо
    // навігаційне меню сайту містить ті самі ключові слова.
    const wantsBachelor = terms.includes('бакалавр');
    const wantsMaster = terms.includes('магістр');
    const wantsDoctoral = terms.includes('аспірантура');
    const wrongStudyLevel = (doc) => {
      const url = String(doc.url || '').toLowerCase();
      if (wantsBachelor && !wantsMaster && !wantsDoctoral) return /\/stati-magistrom\/|\/aspirant\//.test(url);
      if (wantsMaster && !wantsBachelor && !wantsDoctoral) return /\/stati-bakalavrom\/|\/aspirant\//.test(url);
      if (wantsDoctoral && !wantsBachelor && !wantsMaster) return /\/stati-bakalavrom\/|\/stati-magistrom\//.test(url);
      return false;
    };
    const results = mini.search(terms.join(' '), {
      combineWith: 'OR', boost: { title: 3, chunk: 1, topics: 6 },
      prefix: term => term.length >= 4, fuzzy: term => term.length > 6 ? 0.15 : false,
    }).filter(r => !wrongStudyLevel(byId.get(r.id))).map(r => {
      const coverage = Object.keys(r.match || {}).length / terms.length;
      return { ...r, coverage, score: r.score * Math.min(1, coverage) ** 2 * (byId.get(r.id).fetched_at ? 1.6 : 1) };
    }).filter(r => r.coverage >= Math.min(0.5, 1 / terms.length + 0.15)).sort((a, b) => b.score - a.score);
    const selected = [], urls = new Map();
    const bestScore = results[0]?.score || 0;
    for (const result of results) {
      if (result.score < bestScore * 0.4) continue;
      const doc = byId.get(result.id);
      const count = urls.get(doc.url) || 0;
      if (count >= 2) continue;
      urls.set(doc.url, count + 1);
      selected.push({ ...doc, relevance: Number(result.score.toFixed(3)) });
      if (selected.length === limit) break;
    }
    return selected;
  }
  return { search, count: docs.length };
}
