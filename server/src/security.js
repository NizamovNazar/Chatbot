// OA Smart Assistant — public API safeguards, no extra dependencies.
// In-memory limits protect one Node process. Distributed deployment needs a shared store.
const LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
  'http://localhost:3000', 'http://127.0.0.1:3000',
]);

export function allowedOrigin(origin, requestHost, { production = false, configuredOrigins = '' } = {}) {
  if (!origin) return true; // server-to-server requests, curl, same-origin GET
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return false;
  const extra = String(configuredOrigins || '').split(',').map(s => s.trim()).filter(Boolean);
  if (extra.includes(url.origin)) return true;
  // Same host is valid for both local and HTTPS deployment behind a reverse proxy.
  // Client-side browsers cannot set a spoofed Host header.
  if (url.host === requestHost && (!production || url.protocol === 'https:')) return true;
  return !production && LOCAL_DEV_ORIGINS.has(url.origin);
}

export function corsGuard({ production = false, configuredOrigins = '' } = {}) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!allowedOrigin(origin, req.get('host'), {production, configuredOrigins})) {
      return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

export function envInteger(raw, defaultValue, low, high) {
  const text = String(raw ?? '');
  if (!/^\d+$/.test(text)) return defaultValue;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= low && value <= high ? value : defaultValue;
}

export function fixedWindowLimit({ maxRequests, windowMs, maxTrackedIps = 10000, now = () => Date.now() }) {
  const clients = new Map();
  return (req, res, next) => {
    const current = now();
    if (clients.size >= maxTrackedIps) {
      for (const [key, value] of clients) if (value.resetAt <= current) clients.delete(key);
      // Memory upper bound; an attacker cannot create an unbounded number of entries.
      if (clients.size >= maxTrackedIps) clients.delete(clients.keys().next().value);
    }
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = clients.get(ip);
    if (!entry || entry.resetAt <= current) {
      entry = { requests: 0, resetAt: current + windowMs };
      clients.set(ip, entry);
    }
    entry.requests += 1;
    res.set('RateLimit-Limit', String(maxRequests));
    res.set('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.requests)));
    res.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.requests > maxRequests) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - current) / 1000))));
      return res.status(429).json({ ok: false, code: 'rate_limited',
        error: 'Забагато запитів. Спробуйте ще раз трохи пізніше.' });
    }
    next();
  };
}

export function validatedQa(body, { allowEnabled = false } = {}) {
  const question = body?.question;
  const answer = body?.answer;
  if (typeof question !== 'string' || typeof answer !== 'string') return null;
  const q = question.trim();
  const a = answer.trim();
  if (q.length < 3 || q.length > 500 || a.length < 2 || a.length > 5000) return null;
  if (allowEnabled && body.enabled !== undefined && typeof body.enabled !== 'boolean' && body.enabled !== 0 && body.enabled !== 1) return null;
  return { question: q, answer: a };
}

export function validatedQuickItems(value) {
  if (!Array.isArray(value) || value.length > 100) return null;
  const items = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 200) return null;
    items.push(item.trim());
  }
  return items;
}
