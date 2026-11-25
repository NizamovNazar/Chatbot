import * as cheerio from 'cheerio';
import { inspectChunkText } from './knowledgeMetadata.js';

const compact = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const discarded = [
  'script', 'style', 'nav', 'footer', 'header', 'noscript', 'svg', 'iframe', 'form',
  'aside', '[role="navigation"]', '[aria-label="breadcrumb"]',
  '.breadcrumbs', '.breadcrumb', '.navbar', '.navigation', '.sidebar',
  '.menu', '.mobile-menu', '.cookie-banner', '.cookie-notice', '.cookie',
  '.share-buttons', '.social-share', '.related-posts', '.related-news',
  '.site-header', '.site-footer', '.widget', '.ads', '.advertisement',
];
function findRoot($) {
  for (const selector of ['main article', 'article .entry-content', '.entry-content', '.post-content',
    'main', '[role="main"]', 'article', '#content', '.main-content', '.content-area', '#main']) {
    const root = $(selector).first();
    if (compact(root.text()).length >= 25) return root;
  }
  return $('body').first();
}
function uniqAdjacent(lines) {
  const result=[];
  for (const line of lines) if (line && line !== result.at(-1)) result.push(line);
  return result;
}
/**
 * Extract actual headings, paragraphs, lists and table rows without nested
 * duplicate text. Date/canonical metadata remain source data, not facts.
 */
export function cleanText(html) {
  const $ = cheerio.load(String(html || ''));
  const meta = key => $(`meta[property="${key}"],meta[name="${key}"]`).first().attr('content')?.trim() || '';
  const htmlTitle = compact($('title').first().text());
  const main = findRoot($);
  main.find(discarded.join(',')).remove();
  const h1 = compact(main.find('h1').first().text()).slice(0,180);
  const title = compact(h1 || meta('og:title') || htmlTitle).slice(0,250) || 'Без назви';
  const canonical = $('link[rel="canonical"]').first().attr('href') || '';
  const publishedAt = meta('article:published_time') || meta('datePublished') ||
    $('time[datetime]').first().attr('datetime') || '';
  const blocks = [];
  // Select leaf-like text-bearing blocks, skipping paragraphs already included
  // inside list items/table cells. Prevents multi-copy nested DOM extraction.
  main.find('h1,h2,h3,h4,h5,p,li,blockquote,tr,dt,dd,pre').each((_,el) => {
    const tag = el.tagName?.toLowerCase();
    const self = $(el);
    if (self.parents('nav,header,footer,aside,.sidebar,.menu').length) return;
    if ((tag === 'p' || tag === 'li') && self.parents('tr,blockquote,li').length) return;
    if (tag === 'tr') {
      const cells = self.children('th,td').map((_,cell)=>compact($(cell).text())).get().filter(Boolean);
      if (cells.length > 0) blocks.push(cells.join(' | '));
      return;
    }
    const text = compact(self.text());
    if (!text || text.length < 3) return;
    blocks.push(text);
  });
  let lines = uniqAdjacent(blocks);
  if (lines.join(' ').length < 20) {
    // Sites with atypical markup need a readable fallback.
    main.find('br,div,section').each((_,el)=>$(el).append('\n'));
    lines = uniqAdjacent(compact(main.text()).split(/\n+/).map(compact).filter(Boolean));
  }
  // Defensive filter for sidebar menus embedded in unusual markup.
  lines = lines.filter(line => !(line.length < 220 && inspectChunkText(line).menuLike));
  const text = lines.join('\n');
  return { title, text, canonical, publishedAt, extraction: 'semantic-html-v4' };
}

function splitLargeParagraph(text, size) {
  const sentences = String(text || '').split(/(?<=[.!?。])\s+(?=[А-ЯІЇЄҐA-Z0-9«“])/u);
  const parts=[];
  let current='';
  const emit=()=>{if(current){parts.push(current.trim());current='';}};
  for (const raw of sentences) {
    const sentence=raw.trim();
    if (!sentence) continue;
    if (sentence.length > size) {
      emit();
      let rest=sentence;
      while(rest.length>size) {
        let cut=rest.lastIndexOf(' ',size);
        if(cut < Math.floor(size * .55)) cut=rest.indexOf(' ',size);
        if(cut < 0) {parts.push(rest);rest='';break;}
        parts.push(rest.slice(0,cut).trim()); rest=rest.slice(cut+1).trim();
      }
      if(rest)current=rest;
      continue;
    }
    if(current && current.length+sentence.length+1 > size)emit();
    current=current ? `${current} ${sentence}` : sentence;
  }
  emit();
  return parts;
}
/** No mid-word cuts, preserving heading and paragraph boundaries. */
export function chunkText(text, size = 1300) {
  if (!Number.isFinite(size) || size < 40) throw new Error('Invalid chunk size');
  const paragraphs = String(text || '').split(/\n+/).map(compact).filter(Boolean);
  const chunks=[];
  let current='';
  const flush=()=>{ if (current.trim())chunks.push(current.trim()); current=''; };
  for (const paragraph of paragraphs) {
    const parts=paragraph.length > size ? splitLargeParagraph(paragraph,size) : [paragraph];
    for (const part of parts) {
      if(current && current.length+part.length+1 > size)flush();
      current=current ? `${current}\n${part}`:part;
    }
  }
  flush();
  return [...new Set(chunks.filter(c=>c.length>=25))];
}
