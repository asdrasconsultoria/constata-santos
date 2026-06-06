// =============================================================================
// fetch-news.js
// News collection pipeline for Constata Press.
//
// WHAT THIS FILE DOES:
//   1. Reads sources and keywords from rss-sources.js
//   2. Fetches each enabled RSS feed
//   3. Filters articles by keyword
//   4. Normalises articles into the noticias.json schema
//   5. Deduplicates by URL
//   6. Sorts by publication date (newest first)
//   7. Writes the result to noticias.json
//
// WHAT THIS FILE DOES NOT DO:
//   - No club-specific logic (all config lives in rss-sources.js)
//   - No AI, synthesis or indicator features
//   - No source types other than RSS (reserved types log a warning)
//
// EXTENSION POINTS (marked with FUTURE:):
//   - Source type handlers  → add new types without changing core logic
//   - Story grouping        → group related articles before writing output
//   - Relevance scoring     → rank articles beyond chronological order
//   - Deduplication hook    → plug in fuzzy-title matching later
// =============================================================================

import fs                    from 'fs/promises';
import path                  from 'path';
import { fileURLToPath }     from 'url';
import RSSParser             from 'rss-parser';

import { CLUB_META, KEYWORDS, SOURCES } from './rss-sources.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH    = path.resolve(__dirname, '../noticias.json');

// ---------------------------------------------------------------------------
// Internal config
// ---------------------------------------------------------------------------
const MAX_ARTICLES   = 60;   // cap stored in noticias.json
const FETCH_TIMEOUT  = 10000; // ms per feed request


// =============================================================================
// 1. SOURCE TYPE DISPATCHER
// Add a handler here when a new source type is implemented.
// fetch-news.js never needs to know which club is running.
// =============================================================================

const SOURCE_HANDLERS = {
  rss: fetchRSS,

  // FUTURE: register handlers for additional source types
  // blog:     fetchBlog,
  // youtube:  fetchYouTube,
  // document: fetchDocument,
  // social:   fetchSocial,
};


// =============================================================================
// 2. MAIN
// =============================================================================

async function main() {
  console.log(`\n[${CLUB_META.name}] Starting news collection…`);

  const enabledSources = SOURCES.filter(s => s.enabled);
  console.log(`  Sources enabled: ${enabledSources.length} of ${SOURCES.length}`);

  // --- Fetch all sources in parallel ---
  const results = await Promise.allSettled(
    enabledSources.map(source => dispatchSource(source))
  );

  // Flatten successful batches; log failures without crashing
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

  // --- Filter, deduplicate, score, sort ---
  const filtered     = filterByKeyword(raw, KEYWORDS);
  const deduped      = deduplicateByUrl(filtered);
  const scored       = scoreArticles(deduped);       // FUTURE: replace with richer scoring
  const sorted       = sortByDate(scored);
  const trimmed      = sorted.slice(0, MAX_ARTICLES);

  console.log(`  After filter:     ${filtered.length}`);
  console.log(`  After dedupe:     ${deduped.length}`);
  console.log(`  Saved to output:  ${trimmed.length}`);

  // FUTURE: groupRelatedStories(trimmed) before writing output

  // --- Build final output ---
  const output = buildOutput(trimmed);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n  ✓ noticias.json updated — ${output.meta.lastUpdated}\n`);
}


// =============================================================================
// 3. SOURCE DISPATCHER
// Routes each source to the correct handler based on its type field.
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
// Fetches and parses a single RSS feed.
// Returns an array of normalised article objects.
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
// Maps a raw RSS item to the noticias.json article schema.
// All articles — regardless of source type — must pass through here.
//
// SCHEMA (matches what app.js and index.html expect):
//   id            string   — stable unique identifier
//   title         string
//   summary       string
//   content       string   — full body (may be empty for RSS-only sources)
//   category      string   — from source config; future: auto-classified
//   source        string   — human-readable source name
//   sourceUrl     string   — link to original article
//   imageUrl      string   — open graph or feed image
//   publishedAt   string   — ISO 8601
//   featured      boolean  — false by default; set manually or via future scoring
//   relevanceScore number  — 0–100; used to auto-select featured if none is set
//   tags          string[] — reserved for future taxonomy
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
    imageUrl:       extractImage(item),
    publishedAt:    parseDate(item.pubDate ?? item.isoDate),
    featured:       false,
    relevanceScore: 0,   // FUTURE: computed by scoreArticles()
    tags:           [],  // FUTURE: populated by taxonomy classifier
  };
}


// =============================================================================
// 6. FILTERING
// Keeps only articles that mention at least one configured keyword.
// Case-insensitive. Checks title, summary and content.
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
// Removes articles with the same sourceUrl.
// FUTURE: replace or extend with fuzzy title matching.
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
// 8. SCORING  (extension point)
// Currently returns articles unchanged with score 0.
// FUTURE: analyse keyword density, source authority, recency boost, etc.
// =============================================================================

function scoreArticles(articles) {
  // FUTURE: compute relevanceScore per article
  return articles;
}


// =============================================================================
// 9. SORTING
// Newest articles first. Falls back to array order if date is missing.
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
// Wraps the article array in the noticias.json envelope.
// =============================================================================

function buildOutput(articles) {
  return {
    meta: {
      club:         CLUB_META.id,
      lastUpdated:  new Date().toISOString(),
      totalItems:   articles.length,
      // FUTURE: schemaVersion, generatedBy, sourceSummary
    },
    news: articles,
  };
}


// =============================================================================
// HELPERS
// =============================================================================

// Stable ID: base-64 of the URL (URL-safe, no external dependency)
function generateId(raw) {
  return Buffer.from(raw ?? Math.random().toString())
    .toString('base64url')
    .slice(0, 20);
}

// Strip HTML tags and collapse whitespace
function cleanText(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ISO 8601 date or null
function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Extract the best available image from an RSS item
function extractImage(item) {
  // Standard media namespace
  if (item['media:content']?.$.url)  return item['media:content'].$.url;
  if (item['media:thumbnail']?.$.url) return item['media:thumbnail'].$.url;

  // Some feeds embed an <img> inside content
  const contentHtml = item.content ?? item['content:encoded'] ?? '';
  const imgMatch    = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  // Enclosure (podcasts / some news feeds)
  if (item.enclosure?.url) return item.enclosure.url;

  return '';
}


// =============================================================================
// RUN
// =============================================================================

main().catch(err => {
  console.error('\n  [fatal]', err.message);
  process.exit(1);
});
