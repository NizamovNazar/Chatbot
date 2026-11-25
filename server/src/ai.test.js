import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiRouter } from './ai.js';

const credentials = { GEMINI_API_KEY: 'test-google', OPENROUTER_API_KEY: 'test-router', CLOUDFLARE_API_TOKEN: 'test-cloudflare', CLOUDFLARE_ACCOUNT_ID: 'test-account' };
const reply = (content = 'Verified answer') => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });

test('missing keys make no requests and expose no credentials', async () => {
  const router = createAiRouter({}, { fetchImpl: () => assert.fail('No network expected') });
  await assert.rejects(router.generate([]), { code: 'AI_NOT_CONFIGURED' });
  assert.equal(router.status().configured, false);
  assert.ok(router.status().providers.every(p => p.state === 'missing_key'));
});

test('primary success stops fallbacks and records identity', async () => {
  const events = [];
  let count = 0;
  const router = createAiRouter(credentials, { onAttempt: e => events.push(e), fetchImpl: async (url, options) => {
    count++;
    assert.match(url, /generativelanguage/);
    assert.equal(options.headers.Authorization, 'Bearer test-google');
    assert.equal(JSON.parse(options.body).model, 'gemini-4-hydrogen');
    assert.ok(options.signal);
    return reply();
  } });
  assert.equal((await router.generate([{ role: 'user', content: 'Question' }])).provider, 'gemini');
  assert.equal(count, 1);
  assert.equal(events[0].status, 'ok');
  assert.equal(router.status().activeProvider, 'gemini');
  assert.ok(!JSON.stringify(router.status()).includes('test-google'));
});

test('429 respects Retry-After and skips primary until cooldown expires', async () => {
  let clock = 100000;
  const urls = [];
  const router = createAiRouter(credentials, { now: () => clock, fetchImpl: async url => {
    urls.push(url);
    return url.includes('googleapis') ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : reply();
  } });
  assert.equal((await router.generate([])).provider, 'openrouter');
  assert.equal(router.status().providers[0].state, 'cooldown');
  await router.generate([]);
  assert.equal(urls.filter(x => x.includes('googleapis')).length, 1);
  clock += 121000;
  await router.generate([]);
  assert.equal(urls.filter(x => x.includes('googleapis')).length, 2);
});

test('date Retry-After is honored', async () => {
  const clock = Date.parse('2026-11-19T12:00:00Z');
  const router = createAiRouter(credentials, { now: () => clock, fetchImpl: async url => url.includes('googleapis')
    ? new Response('', { status: 429, headers: { 'Retry-After': 'Thu, 19 Nov 2026 12:05:00 GMT' } }) : reply() });
  await router.generate([]);
  assert.equal(router.status().providers[0].retryAt, '2026-11-19T12:05:00.000Z');
});

test('empty response and auth failure fall through to Cloudflare', async () => {
  const events = [];
  const router = createAiRouter(credentials, { onAttempt: e => events.push(e), fetchImpl: async (url, options) => {
    if (url.includes('googleapis')) return reply(' ');
    if (url.includes('openrouter')) return new Response('secret upstream details', { status: 401 });
    assert.match(url, /accounts\/test-account\/ai\/v1\/chat\/completions$/);
    assert.equal(JSON.parse(options.body).model, '@cf/google/gemma-4-26b-a4b-it');
    return reply();
  } });
  assert.equal((await router.generate([])).provider, 'cloudflare');
  assert.deepEqual(events.map(e => e.status), ['error', 'error', 'ok']);
  assert.ok(!JSON.stringify(router.status()).includes('secret upstream'));
});

test('timeout aborts request and uses next configured provider', async () => {
  const router = createAiRouter({ ...credentials, AI_TIMEOUT_MS: '15' }, { fetchImpl: async (url, { signal }) => {
    if (!url.includes('googleapis')) return reply();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  assert.equal((await router.generate([])).provider, 'openrouter');
  assert.equal(router.status().providers[0].lastError, 'TIMEOUT');
});

test('total deadline prevents additional upstream calls', async () => {
  let clock = 100;
  let count = 0;
  const router = createAiRouter({ ...credentials, AI_TOTAL_TIMEOUT_MS: '10' }, { now: () => clock, fetchImpl: async () => {
    count++; clock += 11; return new Response('', { status: 503 });
  } });
  await assert.rejects(router.generate([]), { code: 'AI_UNAVAILABLE' });
  assert.equal(count, 1);
});

test('paid OpenRouter models are rejected, missing Cloudflare account is skipped', async () => {
  const router = createAiRouter({ OPENROUTER_API_KEY: 'secret', OPENROUTER_MODEL: 'paid/model', CLOUDFLARE_API_TOKEN: 'secret' }, { fetchImpl: () => assert.fail('No network expected') });
  await assert.rejects(router.generate([]), { code: 'AI_NOT_CONFIGURED' });
  assert.equal(router.status().providers[1].state, 'invalid_model');
  assert.equal(router.status().providers[2].state, 'missing_key');
});

test('all providers fail safely, then cooldown avoids hammering providers', async () => {
  let count = 0;
  const router = createAiRouter(credentials, { fetchImpl: async () => { count++; throw new Error('secret details'); } });
  await assert.rejects(router.generate([]), { code: 'AI_UNAVAILABLE' });
  await assert.rejects(router.generate([]), { code: 'AI_UNAVAILABLE' });
  assert.equal(count, 3);
  assert.ok(router.status().providers.every(p => p.lastError === 'NETWORK'));
});

test('provider order can be changed without editing code', async () => {
  const router = createAiRouter({ ...credentials, AI_PROVIDERS: 'cloudflare,gemini' }, { fetchImpl: async () => reply() });
  assert.equal((await router.generate([])).provider, 'cloudflare');
  assert.throws(() => createAiRouter({ AI_PROVIDERS: 'unknown' }), /Invalid AI_PROVIDERS/);
});
