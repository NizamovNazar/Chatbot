// Only public status fields leave this module; credentials and upstream bodies stay private.
const numberInRange = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function createAiRouter(env = process.env, { fetchImpl = fetch, now = Date.now, onAttempt = () => {},beforeAttempt=()=>{} } = {}) {
  const timeoutMs = numberInRange(env.AI_TIMEOUT_MS, 12000, 10, 60000);
  const totalTimeoutMs = numberInRange(env.AI_TOTAL_TIMEOUT_MS, 35000, 10, 120000);
  const maxTokens = numberInRange(env.AI_MAX_TOKENS, 1200, 64, 8192);
  const definitions = [
    { id: 'gemini', model: env.GEMINI_MODEL || 'gemini-4-hydrogen', key: env.GEMINI_API_KEY,
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', extra: { reasoning_effort: 'low' } },
    { id: 'openrouter', model: env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free', key: env.OPENROUTER_API_KEY,
      url: 'https://openrouter.ai/api/v1/chat/completions', extra: { reasoning: { enabled: false } } },
    { id: 'cloudflare', model: env.CLOUDFLARE_MODEL || '@cf/google/gemma-4-26b-a4b-it', key: env.CLOUDFLARE_API_TOKEN,
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || '')}/ai/v1/chat/completions` },
  ];
  const order = (env.AI_PROVIDERS || 'gemini,openrouter,cloudflare').split(',').map(x => x.trim()).filter(Boolean);
  if (!order.length || order.some(id => !definitions.some(p => p.id === id))) throw new Error('Invalid AI_PROVIDERS');
  const providers = [...new Set(order)].map(id => {
    const p = definitions.find(item => item.id === id);
    const missing = !p.key?.trim() || (id === 'cloudflare' && !env.CLOUDFLARE_ACCOUNT_ID?.trim());
    return { ...p, configured: !missing, invalid: id === 'openrouter' && !p.model.endsWith(':free'), retryAt: 0, lastError: null };
  });
  let lastSuccess = null;
  const status = () => ({
    configured: providers.some(p => p.configured && !p.invalid),
    primary: providers[0].id,
    activeProvider: lastSuccess?.provider || null,
    activeModel: lastSuccess?.model || null,
    lastSuccessAt: lastSuccess?.at || null,
    providers: providers.map(p => ({
      id: p.id, model: p.model, configured: p.configured && !p.invalid,
      state: !p.configured ? 'missing_key' : p.invalid ? 'invalid_model' : p.retryAt > now() ? 'cooldown' : 'ready',
      retryAt: p.retryAt > now() ? new Date(p.retryAt).toISOString() : null,
      lastError: p.lastError,
    })),
  });
  async function generate(messages) {
    const deadline = now() + totalTimeoutMs;
    for (const p of providers) {
      if (!p.configured || p.invalid || p.retryAt > now()) continue;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await beforeAttempt(p.id);
      const started = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
      let httpStatus = 0;
      let retryMs = 10000;
      try {
        const res = await fetchImpl(p.url, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
          body: JSON.stringify({ model: p.model, messages, temperature: 0.1, max_tokens: maxTokens, ...p.extra }),
        });
        httpStatus = res.status;
        if (!res.ok) {
          if (httpStatus === 429) {
            const retry = res.headers.get('retry-after');
            const seconds = retry?.trim() ? Number(retry) : NaN;
            retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now();
            if (!Number.isFinite(retryMs) || retryMs <= 0) retryMs = 60000;
          } else if ([400, 401, 403, 404].includes(httpStatus)) retryMs = 300000;
          // Release the connection without logging raw provider errors or credentials.
          await res.body?.cancel();
          throw new Error(`HTTP_${httpStatus}`);
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        const answer = typeof content === 'string' ? content.trim() : '';
        if (!answer || data.error || data.success === false) throw new Error('INVALID_RESPONSE');
        p.retryAt = 0;
        p.lastError = null;
        lastSuccess = { provider: p.id, model: p.model, at: new Date(now()).toISOString() };
        await onAttempt({ ts: lastSuccess.at, provider: p.id, model: p.model, status: 'ok', latencyMs: now() - started });
        return { answer, provider: p.id, model: p.model };
      } catch (err) {
        const code = controller.signal.aborted ? 'TIMEOUT' : httpStatus >= 400 ? `HTTP_${httpStatus}` : err.message === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'NETWORK';
        p.lastError = code;
        p.retryAt = now() + Math.min(86400000, Math.max(1000, retryMs));
        await onAttempt({ ts: new Date(now()).toISOString(), provider: p.id, model: p.model, status: 'error', errorCode: code, latencyMs: now() - started });
      } finally {
        clearTimeout(timer);
      }
    }
    const error = new Error(status().configured ? 'AI_UNAVAILABLE' : 'AI_NOT_CONFIGURED');
    error.code = error.message;
    throw error;
  }
  return { generate, status };
}
