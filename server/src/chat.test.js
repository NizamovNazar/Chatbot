import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('chat API validates input, clarifies unknown groups and falls back to quoted sources without API keys', { timeout: 15000 }, async () => {
  const prefix = path.resolve('../.launcher/chat-test-');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const directory = fs.mkdtempSync(prefix);
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'data/docs.json'), JSON.stringify([
    { id: 1, url: 'https://www.oa.edu.ua/ua/contacts', title: 'Контакти', chunk: 'Адреса університету: місто Острог, вулиця Семінарська, 2.' },
    { id: 2, url: 'https://www.oa.edu.ua/ua/foreign', title: 'Міжнародні партнери', chunk: 'Міжнародні партнери університету та освітня співпраця.' },
  ]));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [path.resolve('src/index.js')], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), ADMIN_EMAIL: 'unit-test@example.invalid', ADMIN_PASSWORD: 'Test-only-pass-12', AI_PROVIDERS: 'gemini,openrouter,cloudflare', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '', DOTENV_CONFIG_PATH: path.join(directory, 'absent.env') },
  });
  let errors = '';
  child.stderr.on('data', bytes => errors += bytes.toString());
  async function post(body) {
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
    return { status: response.status, data: await response.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, errors);
    const adminUrl = `http://127.0.0.1:${port}/api/admin`;
    const adminRequest = (route, options = {}) => fetch(`${adminUrl}${route}`, options);
    assert.equal((await adminRequest('/analytics')).status, 401, 'unauthenticated analytics must be rejected');
    assert.equal((await adminRequest('/qa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'test', answer: 'test' }) })).status, 401);
    assert.equal((await adminRequest('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unit-test@example.invalid', password: 'wrong' }) })).status, 401);
    const loginResponse = await adminRequest('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unit-test@example.invalid', password: 'Test-only-pass-12' }) });
    assert.equal(loginResponse.status, 200);
    const loginData = await loginResponse.json();
    assert.match(loginData.token, /^[a-f0-9]{64}$/);
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` };
    assert.equal((await adminRequest('/qa', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ question: 'Test FAQ', answer: 'Verified answer' }) })).status, 200);
    const faqResponse = await adminRequest('/qa?lang=uk', { headers: adminHeaders });
    assert.equal(faqResponse.status, 200);
    assert.ok((await faqResponse.json()).some(x => x.question === 'Test FAQ'));
    assert.equal((await adminRequest('/qa', { headers: { Authorization: 'Bearer ' + '0'.repeat(64) } })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    assert.equal((await post({ message: 42 })).status, 400);
    assert.equal((await post({ message: 'x'.repeat(4001) })).status, 400);
    const emptyQuick = await fetch(`http://127.0.0.1:${port}/api/quick?lang=uk`);
    assert.equal(emptyQuick.status, 200, 'public quick questions must not use protected admin route');
    assert.deepEqual((await emptyQuick.json()).items, []);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/quick`, { method:'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await adminRequest('/quick', { method:'PUT', headers: adminHeaders, body: JSON.stringify({lang:'uk',items:['Хто ректор університету?', 'Контакти приймальної комісії']}) })).status, 200);
    const publicQuick = await fetch(`http://127.0.0.1:${port}/api/quick?lang=uk`);
    assert.deepEqual((await publicQuick.json()).items, ['Хто ректор університету?', 'Контакти приймальної комісії']);
    assert.equal((await adminRequest('/reviews')).status, 401, 'unauthed review queue must be protected');
    const multi = await post({ message: 'У 2027 році хочу вступити на магістратуру з дипломом іншої спеціальності. Які вступні випробування, документи, вартість навчання та строки реєстрації?' });
    assert.equal(multi.status, 200);
    assert.equal(multi.data.sourceType, 'multi_extract');
    assert.ok(multi.data.missingNeeds >= 1);
    assert.match(multi.data.answer, /Вартість навчання/);
    assert.match(multi.data.answer, /Вступні випробування/);
    assert.match(multi.data.answer, /Строки та реєстрація/);
    const address = await post({ message: 'Покажи адресу університету' });
    assert.equal(address.status, 200);
    assert.equal(address.data.sourceType, 'extractive');
    assert.match(address.data.answer, /Семінарська/);
    assert.equal(address.data.sources[0].url, 'https://www.oa.edu.ua/ua/contacts');
    assert.match(address.data.responseId, /^[0-9a-f-]{36}$/i);
    const feedbackUrl = `http://127.0.0.1:${port}/api/chat/feedback`;
    const submitFeedback = async body => {
      const response = await fetch(feedbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await submitFeedback({ responseId: 'not-a-real-message', value: 'up' })).status, 404);
    const up = await submitFeedback({ responseId: address.data.responseId, value: 'up', question: 'FAKE FORGED QUESTION', answer: 'FORGED ANSWER' });
    assert.equal(up.status, 200);
    assert.equal(up.data.status, 'pending');
    let listResponse = await adminRequest('/reviews?status=pending', { headers: adminHeaders });
    assert.equal(listResponse.status, 200);
    let reviews = (await listResponse.json()).items;
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].question, 'Покажи адресу університету', 'server must use saved answer, not forged client text');
    const published = await adminRequest(`/reviews/${reviews[0].id}/action`, { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ action: 'publish', question: 'Покажи адресу університету',
        answer: 'Офіційна перевірена адреса університету: Острог, вулиця Семінарська, 2.',
        sourceUrl: 'https://www.oa.edu.ua/ua/contacts', addToQuick: true }) });
    assert.equal(published.status, 200, (await published.clone().text()));
    assert.equal((await published.json()).status, 'published');
    assert.equal((await adminRequest(`/reviews/${reviews[0].id}/action`, { method:'POST',headers:adminHeaders, body:JSON.stringify({action:'publish',answer:'OTHER'}) })).status, 409);
    const cachedAddress = await post({ message: 'Покажи адресу університету' });
    assert.equal(cachedAddress.data.sourceType, 'faq');
    assert.match(cachedAddress.data.answer, /Офіційна перевірена/);
    assert.ok((await (await fetch(`http://127.0.0.1:${port}/api/quick?lang=uk`)).json()).items.includes('Покажи адресу університету'));
    const metrics = await adminRequest('/analytics', { headers: adminHeaders });
    assert.ok((await metrics.json()).quality.reviewedFaqHits >= 1, 'reviewed FAQ should be attributed without guessing tokens');

    const unknown = await post({ message: 'Розклад НЕВІДОМА-99 на понеділок' });
    assert.match(unknown.data.answer, /якої групи/);
    assert.ok(!unknown.data.answer.includes('Історія України'));
    const partners = await post({ message: 'Міжнародні партнери університету' });
    assert.equal(partners.data.sourceType, 'extractive');
    const down = await submitFeedback({ responseId: partners.data.responseId, value: 'down', reason: 'irrelevant' });
    assert.equal(down.status, 200);
    listResponse = await adminRequest('/reviews?status=pending', { headers: adminHeaders });
    reviews = (await listResponse.json()).items;
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].reason, 'irrelevant');
    const fixed = await adminRequest(`/reviews/${reviews[0].id}/action`, { method:'POST', headers:adminHeaders, body:JSON.stringify({
      action:'publish',question:'Міжнародні партнери університету',
      answer:'Міжнародні партнери університету та освітня співпраця — інформація перевірена адміністратором.',
      sourceUrl:'https://www.oa.edu.ua/ua/foreign'
    })});
    assert.equal(fixed.status, 200);
    const corrected = await post({ message:'Міжнародні партнери університету' });
    assert.equal(corrected.data.sourceType, 'faq');
    assert.match(corrected.data.answer, /перевірена адміністратором/);

    assert.ok(!partners.data.answer.includes('Демонстраційні дані'));
    const tuition = await post({ message: 'Яка вартість навчання?' });
    assert.equal(tuition.data.sourceType, 'clarification');
    assert.match(tuition.data.answer, /бакалаврат/);
  } finally {
    child.kill();
    await Promise.race([once(child, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
    if (path.resolve(directory).startsWith(prefix)) fs.rmSync(directory, { recursive: true, force: true });
  }
});
