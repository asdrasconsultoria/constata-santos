// =============================================================================
// fetch-news.js
// News collection pipeline for Constata Press.
//
// WHAT THIS FILE DOES:
//   1. Reads sources and keywords from rss-sources.js
//   2. Fetches each enabled RSS feed
//   3. Filters articles by keyword
//   4. Normalises articles into the noticias.json schema
//   5. Proxies image URLs through images.weserv.nl (avoids hotlink blocking)
//   6. Deduplicates by URL
//   7. Sorts by publication date (newest first)
//   8. Writes the result to noticias.json
// =============================================================================

import fs                from 'fs/promises';
import path              from 'path';
import { fileURLToPath } from 'url';
import RSSParser         from 'rss-parser';

import { CLUB_META, KEYWORDS, SOURCES } from './rss-sources.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

// ---------------------------------------------------------------------------
// Internal config
// ---------------------------------------------------------------------------
const MAX_ARTICLES  = 30;    // cap stored in noticias.json
const FETCH_TIMEOUT = 10000; // ms per feed request


// =============================================================================
// 1. SOURCE TYPE DISPATCHER
// =============================================================================

const SOURCE_HANDLERS = {
  rss: fetchRSS,
  // FUTURE: blog, youtube, document, social
};


// =============================================================================
// 2. MAIN
// =============================================================================

async function main() {
  console.log(`\n[${CLUB_META.name}] Starting news collection…`);

  const enabledSources = SOURCES.filter(s => s.enabled);
  console.log(`  Sources enabled: ${enabledSources.length} of ${SOURCES.length}`);

  const results = await Promise.allSettled(
    enabledSources.map(source => dispatchSource(source))
  );

  const raw = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = enabledSources[i];
    if (result.status === 'fulfilled') {
      console.log(`  ✓  ${source.name} — ${result.value.length} articles`);
      raw.push(...result.value);
    } else {
      console.warn(`  ✗  ${source.name} — ${result.reason?.message ?? 'unknown error'}`);
    }
  }

  console.log(`\n  Raw articles fetched: ${raw.length}`);

  const filtered = filterByKeyword(raw, KEYWORDS);
  const deduped  = deduplicateByUrl(filtered);
  const scored   = scoreArticles(deduped);
  const sorted   = sortByDate(scored);
  const trimmed  = sorted.slice(0, MAX_ARTICLES);

  console.log(`  After filter:     ${filtered.length}`);
  console.log(`  After dedupe:     ${deduped.length}`);
  console.log(`  Saved to output:  ${trimmed.length}`);

  const output = buildOutput(trimmed);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n  ✓ noticias.json updated — ${output.meta.lastUpdated}\n`);
}


// =============================================================================
// 3. SOURCE DISPATCHER
// =============================================================================

async function dispatchSource(source) {
  const handler = SOURCE_HANDLERS[source.type];
  if (!handler) {
    console.warn(`  [skip] Source "${source.id}" has unimplemented type: "${source.type}"`);
    return [];
  }
  return handler(source);
}


// =============================================================================
// 4. RSS HANDLER
// =============================================================================

async function fetchRSS(source) {
  const parser = new RSSParser({
    timeout: FETCH_TIMEOUT,
    headers: { 'User-Agent': 'ConstataPressBot/1.0' },
  });
  const feed = await parser.parseURL(source.url);
  return feed.items.map(item => normaliseArticle(item, source));
}


// =============================================================================
// 5. NORMALISER
// =============================================================================

function normaliseArticle(item, source) {
  return {
    id:             generateId(item.link ?? item.guid ?? item.title),
    title:          cleanText(item.title ?? ''),
    summary:        cleanText(item.contentSnippet ?? item.summary ?? ''),
    content:        item.content ?? item['content:encoded'] ?? '',
    category:       source.category,
    source:         source.name,
    sourceUrl:      item.link ?? item.guid ?? '',
    imageUrl:       proxyImage(extractImage(item)),
    publishedAt:    parseDate(item.pubDate ?? item.isoDate),
    featured:       false,
    relevanceScore: 0,
    tags:           [],
  };
}


// =============================================================================
// 6. FILTERING
// =============================================================================

function filterByKeyword(articles, keywords) {
  if (!keywords?.length) return articles;
  const patterns = keywords.map(kw => new RegExp(kw, 'i'));
  return articles.filter(article => {
    const text = `${article.title} ${article.summary} ${article.content}`;
    return patterns.some(re => re.test(text));
  });
}


// =============================================================================
// 7. DEDUPLICATION
// =============================================================================

function deduplicateByUrl(articles) {
  const seen = new Set();
  return articles.filter(article => {
    if (!article.sourceUrl || seen.has(article.sourceUrl)) return false;
    seen.add(article.sourceUrl);
    return true;
  });
}


// =============================================================================
// 8. SCORING (extension point)
// =============================================================================

function scoreArticles(articles) {
  // FUTURE: compute relevanceScore per article
  return articles;
}


// =============================================================================
// 9. SORTING
// =============================================================================

function sortByDate(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}


// =============================================================================
// 10. OUTPUT BUILDER
// =============================================================================

function buildOutput(articles) {
  return {
    meta: {
      club:        CLUB_META.id,
      lastUpdated: new Date().toISOString(),
      totalItems:  articles.length,
    },
    news: articles,
  };
}


// =============================================================================
// HELPERS
// =============================================================================

function generateId(raw) {
  return Buffer.from(raw ?? Math.random().toString())
    .toString('base64url')
    .slice(0, 20);
}

function cleanText(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractImage(item) {
  if (item['media:content']?.$.url)   return item['media:content'].$.url;
  if (item['media:thumbnail']?.$.url) return item['media:thumbnail'].$.url;

  const contentHtml = item.content ?? item['content:encoded'] ?? '';
  const imgMatch    = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  if (item.enclosure?.url) return item.enclosure.url;

  return '';
}

function proxyImage(url) {
  if (!url) return '';
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
}


// =============================================================================
// RUN
// =============================================================================

main().catch(err => {
  console.error('\n  [fatal]', err.message);
  process.exit(1);
});
