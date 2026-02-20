import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import MiniSearch from 'minisearch';
import { pathToFileURL } from 'url';

const DATA_DIR = path.resolve('data');
const DOCS_PATH = path.join(DATA_DIR, 'docs.json');
const INDEX_PATH = path.join(DATA_DIR, 'docs_index.json');
const META_PATH = path.join(DATA_DIR, 'docs_meta.json');

const SITE_URLS = (process.env.SITE_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES || 300);
const MAX_DEPTH = Number(process.env.CRAWL_MAX_DEPTH || 3);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeUrl(url) {
  return url.split('#')[0].replace(/\/$/, '');
}

function isAllowed(url) {
  return SITE_URLS.some((base) => url.startsWith(base));
}

function extractLinks($, baseUrl) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, baseUrl).toString();
      if (isAllowed(url)) links.add(normalizeUrl(url));
    } catch {}
  });
  return Array.from(links);
}

function cleanText(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript, svg').remove();
  const title = $('title').text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title, text };
}

function chunkText(text, size = 900, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + size);
    chunks.push(chunk.trim());
    i += size - overlap;
  }
  return chunks.filter(Boolean);
}

async function fetchPage(url) {
  const res = await axios.get(url, { timeout: 20000, responseType: 'arraybuffer' });
  const contentType = (res.headers['content-type'] || '').toLowerCase();
  const length = Number(res.headers['content-length'] || 0);
  if (length && length > 2_000_000) return null;
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
  return res.data.toString('utf-8');
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function crawlSite(options = {}) {
  const { onProgress } = options;
  if (SITE_URLS.length === 0) {
    console.log('SITE_URLS is empty. Set in .env');
    return;
  }

  ensureDataDir();
  let prevMeta = {};
  try {
    prevMeta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf-8')) : {};
  } catch {
    prevMeta = {};
  }
  const startedAt = Date.now();

  const docs = [];
  const queue = SITE_URLS.map((u) => ({ url: normalizeUrl(u), depth: 0 }));
  const seen = new Set();
  let count = 0;
  onProgress?.({ status: 'running', indexed: 0, seen: 0, queued: queue.length });

  while (queue.length > 0 && count < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      const html = await fetchPage(url);
      if (!html) {
        console.log(`Skip (non-text): ${url}`);
        continue;
      }

      const { title, text } = cleanText(html);
      if (text && text.length >= 200) {
        const chunks = chunkText(text);
        for (const ch of chunks) {
          docs.push({
            id: docs.length + 1,
            url,
            title,
            chunk: ch,
          });
        }
        count += 1;
        onProgress?.({ status: 'running', indexed: count, seen: seen.size, queued: queue.length });
        console.log(`[${count}] Indexed: ${url}`);
      }

      if (depth < MAX_DEPTH) {
        const $ = cheerio.load(html);
        const links = extractLinks($, url);
        for (const link of links) {
          if (!seen.has(link)) queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch (err) {
      console.log(`Skip: ${url} (${err.message})`);
    }
  }

  const mini = new MiniSearch({
    fields: ['chunk', 'title', 'url'],
    storeFields: ['chunk', 'title', 'url'],
    searchOptions: { prefix: true },
  });

  mini.addAll(docs);

  saveJson(DOCS_PATH, docs);
  saveJson(INDEX_PATH, mini.toJSON());
  saveJson(META_PATH, {
    last_indexed_at: new Date().toISOString(),
    last_indexed_count: count,
    prev_indexed_count: Number(prevMeta.last_indexed_count || 0),
    last_index_duration_ms: Math.max(0, Date.now() - startedAt),
  });

  onProgress?.({ status: 'idle', indexed: count, seen: seen.size, queued: 0, finishedAt: new Date().toISOString() });
  console.log('Crawl complete.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  crawlSite();
}
