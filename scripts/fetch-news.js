// =============================================================================
// fetch-news.js v2.1 - CORRIGIDO PARA IMAGENS
// News collection pipeline para Constata Press - GitHub Actions ready
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
const BROWSER_AGENT  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Imagem placeholder quando nÃ£o encontrar nada
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/600x400/1a1a1a/ffffff?text=Sem+Imagem';

// rss-parser configurado para capturar TODAS as variantes de imagem
const parser = new RSSParser({
  timeout: FETCH_TIMEOUT,
  headers: { 
    'User-Agent': BROWSER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml'
  },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: true }],
      ['media:group',     'media:group'],
      ['enclosure',       'enclosure'],
      ['image',           'image'],
      ['itunes:image',    'itunes:image'],
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
  console.log(`\n[${CLUB_META.name}] Starting news collectionâ€¦`);

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
      console.log(`  âœ“  ${source.name} â€” ${result.value.length} articles`);
      raw.push(...result.value);
    } else {
      console.warn(`  âœ—  ${source.name} â€” ${result.reason?.message ?? 'unknown error'}`);
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

  // Enrich articles that have no image
  console.log(`\n  Enriching imagesâ€¦`);
  const enriched = await enrichImages(trimmed);

  const output = buildOutput(enriched);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n  âœ“ noticias.json updated â€” ${output.meta.lastUpdated}\n`);
}

// =============================================================================
// SOURCE DISPATCHER
// =============================================================================

async function dispatchSource(source) {
  const handler = SOURCE_HANDLERS[source.type];
  if (!handler) {
    console.warn(`  [skip] "${source.id}" â€” unimplemented type: "${source.type}"`);
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
  const rawImage = extractImage(item);
  const imageUrl = cleanImageUrl(rawImage);
  
  return {
    id:             generateId(item.link ?? item.guid ?? item.title),
    title:          cleanText(item.title ?? ''),
    summary:        cleanText(item.contentSnippet ?? item.summary ?? ''),
    content:        item.content ?? item['content:encoded'] ?? '',
    category:       source.category,
    source:         source.name,
    sourceUrl:      item.link ?? item.guid ?? '',
    imageUrl:       imageUrl, // JÃ LIMPO, SEM PROXY
    publishedAt:    parseDate(item.pubDate ?? item.isoDate),
    featured:       false,
    relevanceScore: 0,
    tags:           [],
  };
}

// =============================================================================
// IMAGE ENRICHMENT - VERSÃƒO CORRIGIDA
// =============================================================================

async function enrichImages(articles) {
  const enriched = [];
  let fromRSS = 0;
  let fromOg = 0;
  let placeholder = 0;

  for (const article of articles) {
    if (article.imageUrl && article.imageUrl !== PLACEHOLDER_IMAGE) {
      fromRSS++;
      enriched.push(article);
      continue;
    }

    const ogImage = await fetchOgImage(article.sourceUrl);
    if (ogImage) {
      console.log(`  [img] âœ“ og:image â€” ${article.title.slice(0, 50)}`);
      fromOg++;
      enriched.push({ ...article, imageUrl: cleanImageUrl(ogImage) });
    } else {
      console.log(`  [img] âœ— placeholder â€” ${article.title.slice(0, 50)}`);
      placeholder++;
      enriched.push({ ...article, imageUrl: PLACEHOLDER_IMAGE });
    }
    
    // Delay para nÃ£o sobrecarregar servidores
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  Images: ${fromRSS} do RSS, ${fromOg} do og:image, ${placeholder} placeholder`);
  return enriched;
}

async function fetchOgImage(url) {
  return new Promise(resolve => {
    if (!url) return resolve('');

    const lib     = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      resolve('');
    }, IMAGE_TIMEOUT);

    try {
      const req = lib.get(url, {
        headers: {
          'User-Agent': BROWSER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.google.com/',
        },
        timeout: IMAGE_TIMEOUT,
      }, res => {
        // Seguir redirects
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(timeout);
          res.destroy();
          const redirectUrl = new URL(res.headers.location, url).href;
          fetchOgImage(redirectUrl).then(resolve);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          res.destroy();
          return resolve('');
        }

        let html = '';
        res.setEncoding('utf8');

        res.on('data', chunk => {
          html += chunk;
          // Para assim que achar </head> ou 100KB
          if (html.length > 100000 || html.includes('</head>')) {
            req.destroy();
          }
        });

        res.on('close', () => {
          clearTimeout(timeout);
          // Tenta mÃºltiplos padrÃµes
          const patterns = [
            /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
          ];
          
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
              return resolve(match[1]);
            }
          }
          resolve('');
        });

        res.on('error', () => { clearTimeout(timeout); resolve(''); });
      });

      req.on('error', () => {
        clearTimeout(timeout);
        resolve('');
      });
      req.on('timeout', () => {
        req.destroy();
        clearTimeout(timeout);
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
// SCORING
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
// HELPERS - TOTALMENTE REESCRITOS
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
  // 1. media:content (pode ser array)
  const mc = item['media:content'];
  if (mc) {
    const contents = Array.isArray(mc) ? mc : [mc];
    for (const m of contents) {
      if (typeof m === 'string' && m.startsWith('http')) return m;
      if (m?.$?.url) return m.$.url;
      if (m?.url) return m.url;
    }
  }

  // 2. media:thumbnail
  const mt = item['media:thumbnail'];
  if (mt) {
    const thumbs = Array.isArray(mt) ? mt : [mt];
    for (const t of thumbs) {
      if (typeof t === 'string' && t.startsWith('http')) return t;
      if (t?.$?.url) return t.$.url;
      if (t?.url) return t.url;
    }
  }

  // 3. enclosure
  const enc = item.enclosure;
  if (enc?.url && enc.type?.startsWith('image/')) return enc.url;
  if (typeof enc === 'string' && enc.match(/\.(jpg|jpeg|png|webp)/i)) return enc;

  // 4. itunes:image
  const itunes = item['itunes:image'];
  if (itunes?.$?.href) return itunes.$.href;
  if (typeof itunes === 'string') return itunes;

  // 5. image field
  if (item.image?.url) return item.image.url;
  if (typeof item.image === 'string') return item.image;

  // 6. Procurar no content:encoded (melhor que contentSnippet)
  const contentHtml = item['content:encoded'] ?? item.content ?? '';
  const imgMatches = [...contentHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
  for (const match of imgMatches) {
    const src = match[1];
    // Ignora tracking pixels e Ã­cones pequenos
    if (src && !src.includes('1x1') && !src.includes('pixel') && !src.includes('spacer')) {
      return src;
    }
  }

  return '';
}

// NOVA FUNÃ‡ÃƒO CRÃTICA - Limpa URL sem usar proxy
function cleanImageUrl(url) {
  if (!url) return '';
  
  let cleaned = url.trim();
  
  // Remove parÃ¢metros de tracking que quebram cache
  cleaned = cleaned.split('?')[0];
  
  // ForÃ§a HTTPS (GitHub Pages exige)
  if (cleaned.startsWith('http://')) {
    cleaned = cleaned.replace('http://', 'https://');
  }
  
  // Corrige URLs relativas
  if (cleaned.startsWith('//')) {
    cleaned = 'https:' + cleaned;
  }
  
  // Valida
  if (!cleaned.startsWith('https://')) {
    return '';
  }
  
  // NÃƒO USA MAIS PROXY - retorna direto
  return cleaned;
}

// =============================================================================
// RUN
// =============================================================================

main().catch(err => {
  console.error('\n  [fatal]', err.message);
  process.exit(1);
});
