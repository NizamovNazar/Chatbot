import test from 'node:test';
import assert from 'node:assert/strict';
import { planInformationNeeds, answerInformationNeeds } from './multiIntent.js';
import { createKnowledgeSearch } from './knowledge.js';

test('one missing yearly price never suppresses other questions', () => {
  const complex = 'Я вступаю на магістратуру F3 у 2027 році з дипломом іншої спеціальності. Які вступні випробування, документи, вартість навчання та строки реєстрації?';
  const needs = planInformationNeeds(complex);
  assert.deepEqual(needs.map(n=>n.id), ['eligibility','exams','documents','fees','deadlines']);
  const search = createKnowledgeSearch([
    { id: 1, title: 'Вартість навчання | Магістр', url: 'https://vstup.oa.edu.ua/stati-magistrom/vartist-navchannya', chunk: 'У 2026 році вартість контрактного навчання становить довідкову суму. Це історична інформація.' },
    { id: 2, title: 'Календар проведення ЄВІ/ЄФВВ', url: 'https://vstup.oa.edu.ua/stati-magistrom/kalendar-provedennya-eviefvv', chunk: 'У 2026 році вступні випробування проводяться згідно з календарем.' },
    { id: 3, title: 'Порядок та строки прийому заяв та документів для участі у конкурсному відборі | Магістр', url: 'https://vstup.oa.edu.ua/stati-magistrom/dokumenti-ta-stroki-prijomu', chunk: 'У 2026 році заяви для вступу до магістратури приймають згідно з чинним календарем.' },
  ]);
  const result = answerInformationNeeds(needs, complex, search.search);
  assert.equal(result.unanswered, 5);
  assert.match(result.answer, /Вступні випробування/);
  assert.match(result.answer, /Вартість навчання/);
  assert.match(result.answer, /Документи для вступу/);
  assert.match(result.answer, /2027/);
  assert.doesNotMatch(result.answer, /в 2026 році вартість/i);
  assert.ok(result.sources.some(s=>s.url.includes('vartist-navchannya')));
  assert.ok(result.sources.some(s=>s.url.includes('kalendar')));
});

test('multiple facets can be independently answered if same-year evidence exists', () => {
  const question = 'Які вступні випробування та документи для магістратури 2027?';
  const search = createKnowledgeSearch([
    { id: 1, title: 'Вступні випробування у магістратуру', url: 'https://vstup.oa.edu.ua/stati-magistrom/jevi', chunk: 'У 2027 році вступні випробування для магістратури включають ЄВІ.' },
    { id: 2, title: 'Документи для магістратури', url: 'https://vstup.oa.edu.ua/stati-magistrom/dokumenti-ta-stroki-prijomu', chunk: 'У 2027 році документами є диплом бакалавра і заява вступника.' },
  ]);
  const result = answerInformationNeeds(planInformationNeeds(question), question, search.search);
  assert.equal(result.answered, 2);
  assert.equal(result.unanswered, 0);
  assert.ok(result.sources.length >= 1);
  assert.match(result.answer, /2027/);
});

test('short single-topic query does not trigger multi-intent mode', () => {
  assert.equal(planInformationNeeds('Яка вартість навчання на магістратурі?').length, 1);
});
