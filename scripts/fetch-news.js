// =============================================================================
// fetch-news.js
// News collection pipeline for Constata Press.
// =============================================================================

import fs                from 'fs/promises';
import path              from 'path';
import { fileURLToPath } from 'url';
import https             from 'https';
import http              from 'http';
import RSSParser         from 'rss-parser';

import { CLUB_META, KEYWORDS, SOURCES } from './rss-sources.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const MAX_ARTICLES   = 30;
const FETCH_TIMEOUT  = 10000;
const IMAGE_TIMEOUT  = 8000;
const BROWSER_AGENT  = 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// rss-parser configured to capture all common image field variants
const parser = new RSSParser({
  timeout: FETCH_TIMEOUT,
  headers: { 'User-Agent': BROWSER_AGENT },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
      ['enclosure',       'enclosure',       { keepArray: false }],
    ],
  },
});

const SOURCE_HANDLERS = {
  rss: fetchRSS,
};

// =============================================================================
// MAIN
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

  // Enrich articles that have no image with og:image from article page
  console.log(`\n  Enriching images…`);
  const enriched = await enrichImages(trimmed);

  const output = buildOutput(enriched);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n  ✓ noticias.json updated — ${output.meta.lastUpdated}\n`);
}

// =============================================================================
// SOURCE DISPATCHER
// =============================================================================

async function dispatchSource(source) {
  const handler = SOURCE_HANDLERS[source.type];
  if (!handler) {
    console.warn(`  [skip] "${source.id}" — unimplemented type: "${source.type}"`);
    return [];
  }
  return handler(source);
}

// =============================================================================
// RSS HANDLER
// =============================================================================

async function fetchRSS(source) {
  const feed = await parser.parseURL(source.url);
  return feed.items.map(item => normaliseArticle(item, source));
}

// =============================================================================
// NORMALISER
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
// IMAGE ENRICHMENT
// For articles with no image from RSS, fetch og:image from the article page.
// Runs sequentially to avoid overwhelming servers.
// =============================================================================

async function enrichImages(articles) {
  const enriched = [];
  let hits = 0;
  let misses = 0;

  for (const article of articles) {
    if (article.imageUrl) {
      enriched.push(article);
      continue;
    }

    const ogImage = await fetchOgImage(article.sourceUrl);
    if (ogImage) {
      console.log(`  [img] ✓ og:image found — ${article.title.slice(0, 50)}`);
      hits++;
      enriched.push({ ...article, imageUrl: proxyImage(ogImage) });
    } else {
      console.log(`  [img] ✗ no image — ${article.title.slice(0, 50)}`);
      misses++;
      enriched.push(article);
    }
  }

  console.log(`  Images enriched: ${hits} found, ${misses} not found`);
  return enriched;
}

async function fetchOgImage(url) {
  return new Promise(resolve => {
    if (!url) return resolve('');

    const lib     = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      console.log(`  [img] timeout — ${url.slice(0, 60)}`);
      resolve('');
    }, IMAGE_TIMEOUT);

    try {
      const req = lib.get(url, {
        headers: {
          'User-Agent': BROWSER_AGENT,
          'Accept': 'text/html',
        }
      }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(timeout);
          res.destroy();
          fetchOgImage(res.headers.location).then(resolve);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          res.destroy();
          console.log(`  [img] HTTP ${res.statusCode} — ${url.slice(0, 60)}`);
          return resolve('');
        }

        let html = '';
        res.setEncoding('utf8');

        res.on('data', chunk => {
          html += chunk;
          if (html.length > 50000 || html.includes('</head>')) {
            req.destroy();
          }
        });

        res.on('close', () => {
          clearTimeout(timeout);
          const match =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          resolve(match ? match[1] : '');
        });

        res.on('error', () => { clearTimeout(timeout); resolve(''); });
      });

      req.on('error', err => {
        clearTimeout(timeout);
        console.log(`  [img] error — ${err.message}`);
        resolve('');
      });

    } catch (err) {
      clearTimeout(timeout);
      resolve('');
    }
  });
}

// =============================================================================
// FILTERING
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
// DEDUPLICATION
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
// SCORING (extension point)
// =============================================================================

function scoreArticles(articles) {
  return articles;
}

// =============================================================================
// SORTING
// =============================================================================

function sortByDate(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}

// =============================================================================
// OUTPUT BUILDER
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
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractImage(item) {
  // Try all common RSS image field variants
  const mc = item['media:content'];
  if (mc) {
    if (typeof mc === 'string') return mc;
    if (mc.$ && mc.$.url) return mc.$.url;
    if (mc.url) return mc.url;
  }

  const mt = item['media:thumbnail'];
  if (mt) {
    if (typeof mt === 'string') return mt;
    if (mt.$ && mt.$.url) return mt.$.url;
    if (mt.url) return mt.url;
  }

  const enc = item.enclosure;
  if (enc) {
    if (enc.url && enc.type?.startsWith('image/')) return enc.url;
  }

  // Try embedded img tag in content
  const contentHtml = item.content ?? item['content:encoded'] ?? '';
  const imgMatch = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

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
