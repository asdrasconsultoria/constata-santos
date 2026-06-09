import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const CLUB_META = { id: 'santos', name: 'Constata Santos' };

const KEYWORDS = [
  'Santos', 'Peixe', 'Vila Belmiro', 'Santos FC',
  'Neymar', 'Gabigol', 'Cuca', 'Miguelito',
  'Brazão', 'Bontempo', 'Deivid', 'Soteldo',
];

const MAX_ARTICLES = 50;

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES = [

  // ── Google News — fonte principal ─────────────────────────────────────────
  {
    id: 'gnews-santos-fc',
    name: 'Google News — Santos FC',
    url: 'https://news.google.com/rss/search?q=%22Santos+FC%22&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'gnews-neymar-santos',
    name: 'Google News — Neymar Santos',
    url: 'https://news.google.com/rss/search?q=Neymar+Santos+FC&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'gnews-santos-brasileiro',
    name: 'Google News — Santos Brasileirão',
    url: 'https://news.google.com/rss/search?q=%22Santos%22+Brasileiro+futebol&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'gnews-santos-transferencias',
    name: 'Google News — Santos mercado',
    url: 'https://news.google.com/rss/search?q=%22Santos+FC%22+transfer%C3%AAncia+OR+contrato+OR+refor%C3%A7o&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'mercado',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'gnews-peixe',
    name: 'Google News — Peixe Vila Belmiro',
    url: 'https://news.google.com/rss/search?q=%22Peixe%22+%22Vila+Belmiro%22&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },

  // ── Sites dedicados ao Santos ─────────────────────────────────────────────
  {
    id: 'diario-peixe',
    name: 'Diário do Peixe',
    url: 'https://www.diariodopeixe.com.br/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'soul-santista',
    name: 'Blog Soul Santista',
    url: 'https://blogsoulsantista.com.br/feed/',
    category: 'opiniao',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'santistas-net',
    name: 'Santistas.net',
    url: 'https://santistas.net/noticias-do-santos/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'santos-oficial',
    name: 'Santos FC Oficial',
    url: 'https://www.santosfc.com.br/feed/',
    category: 'oficial',
    enabled: true,
    skipKeywordFilter: true,
  },

  // ── Portais esportivos ────────────────────────────────────────────────────
  {
    id: 'gazeta-santos',
    name: 'Gazeta Esportiva',
    url: 'https://www.gazetaesportiva.com/times/santos/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'gazeta-tag-santos',
    name: 'Gazeta Esportiva (tag)',
    url: 'https://www.gazetaesportiva.com/tag/santos-fc/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'trivela',
    name: 'Trivela',
    url: 'https://trivela.com.br/feed/',
    category: 'analise',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'bolavip',
    name: 'Bolavip',
    url: 'https://br.bolavip.com/rss/feed/category/campeonato-brasileirao',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDERS POR CATEGORIA
// Imagens temáticas diferentes por categoria — evita repetição visual
// mesmo quando nenhuma imagem real é encontrada.
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDERS = {
  futebol:       'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=600&h=400&fit=crop',
  mercado:       'https://images.unsplash.com/photo-1565109450072-f3fcdf84e61a?w=600&h=400&fit=crop',
  analise:       'https://images.unsplash.com/photo-1551958219-acbc630e2914?w=600&h=400&fit=crop',
  opiniao:       'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600&h=400&fit=crop',
  oficial:       'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&h=400&fit=crop',
  bastidores:    'https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=600&h=400&fit=crop',
  institucional: 'https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=600&h=400&fit=crop',
  _default:      'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&h=400&fit=crop',
};

function getPlaceholder(category) {
  return PLACEHOLDERS[category] || PLACEHOLDERS._default;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA DE OG:IMAGE
//
// O Google News RSS inclui no campo <link> a URL do artigo original
// (ex: https://ge.globo.com/futebol/...) — NÃO a URL do Google News.
// Então fetchOgImage vai direto ao artigo real e pega o og:image.
//
// Para outros sites (Diário do Peixe, Gazeta etc.) o og:image é
// backup — eles já entregam imagem no RSS via media:content.
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_FETCH_TIMEOUT   = 6000;  // 6s por artigo
const IMAGE_FETCH_CONCURRENCY = 10;  // 10 em paralelo
const _imageCache = new Map();

async function fetchOgImage(articleUrl) {
  if (!articleUrl) return '';
  if (_imageCache.has(articleUrl)) return _imageCache.get(articleUrl);

  try {
    const html = await fetchHtmlWithRedirects(articleUrl, IMAGE_FETCH_TIMEOUT, 5);
    if (!html) { _imageCache.set(articleUrl, ''); return ''; }

    // Tenta og:image primeiro, depois twitter:image, depois primeira <img>
    const img =
      extractMeta(html, 'og:image') ||
      extractMeta(html, 'twitter:image') ||
      extractMeta(html, 'og:image:secure_url') ||
      extractFirstImg(html);

    const cleaned = img ? cleanUrl(img) : '';
    _imageCache.set(articleUrl, cleaned);
    return cleaned;
  } catch {
    _imageCache.set(articleUrl, '');
    return '';
  }
}

function extractMeta(html, property) {
  // Suporta property="og:image" e name="og:image" em qualquer ordem
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"'\\s][^"']+)["']` +
    `|<meta[^>]+content=["']([^"'\\s][^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || '') : '';
}

function extractFirstImg(html) {
  // Pega a primeira <img> com src https dentro do <body>
  const body = html.split(/<body/i)[1] || html;
  const m = body.match(/<img[^>]+src=["'](https:\/\/[^"'\s>]{20,})["']/i);
  return m ? m[1] : '';
}

// Faz GET seguindo redirects HTTP encadeados (até maxRedirects vezes)
function fetchHtmlWithRedirects(url, timeout, maxRedirects) {
  return new Promise((resolve) => {
    let redirectsLeft = maxRedirects;
    let settled = false;

    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    // Timer global para toda a cadeia
    const globalTimer = setTimeout(() => done(''), timeout);

    function doRequest(currentUrl) {
      try {
        const lib = currentUrl.startsWith('https') ? https : http;
        const req = lib.get(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9',
          },
        }, (res) => {
          // Redirect
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // drena o body
            if (redirectsLeft-- <= 0) { done(''); return; }
            const next = resolveUrl(res.headers.location, currentUrl);
            if (!next) { done(''); return; }
            doRequest(next);
            return;
          }

          // Resposta não-HTML (imagem, PDF etc.) — ignora
          const ct = res.headers['content-type'] || '';
          if (!ct.includes('html') && !ct.includes('text')) {
            res.resume();
            done('');
            return;
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
            // Para após 40kb — suficiente para o <head> com os meta tags
            if (data.length > 40000) {
              req.destroy();
              clearTimeout(globalTimer);
              done(data);
            }
          });
          res.on('end', () => {
            clearTimeout(globalTimer);
            done(data);
          });
          res.on('error', () => done(''));
        });

        req.on('error', () => done(''));
        req.setTimeout(timeout, () => { req.destroy(); done(''); });
      } catch {
        done('');
      }
    }

    doRequest(url);
  });
}

// Resolve URL relativa para absoluta usando a URL base
function resolveUrl(location, base) {
  try {
    return new URL(location, base).href;
  } catch {
    return '';
  }
}

// Enriquece artigos sem imagem buscando o og:image do artigo original
async function enrichImages(articles) {
  const needsImage = articles.filter(a => !a.image);
  if (needsImage.length === 0) {
    console.log('  → Todos os artigos já têm imagem do RSS.');
    return articles;
  }

  console.log(`  → Buscando og:image para ${needsImage.length} artigos...`);

  let found = 0;
  for (let i = 0; i < needsImage.length; i += IMAGE_FETCH_CONCURRENCY) {
    const batch = needsImage.slice(i, i + IMAGE_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(a => fetchOgImage(a.sourceUrl))
    );
    results.forEach((r, idx) => {
      const img = r.status === 'fulfilled' ? r.value : '';
      if (img) {
        batch[idx].image    = img;
        batch[idx].imageUrl = img;
        found++;
      }
    });
  }

  console.log(`  → Imagens encontradas: ${found}/${needsImage.length}`);
  return articles;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER RSS
// ─────────────────────────────────────────────────────────────────────────────

const FEED_UA = 'Mozilla/5.0 (compatible; Feedbot/1.0; +https://constatasantos.github.io)';

const parser = new RSSParser({
  timeout: 12000,
  headers: {
    'User-Agent': FEED_UA,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: true }],
      ['enclosure',       'enclosure'],
      ['content:encoded', 'content:encoded'],
    ],
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[${CLUB_META.name}] Iniciando busca de notícias...`);
  const start = Date.now();

  const enabled = SOURCES.filter(s => s.enabled);
  console.log(`  Fontes habilitadas: ${enabled.length}\n`);

  const results = await Promise.allSettled(
    enabled.map(source => fetchSource(source))
  );

  const raw      = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const filtered = filterByKeyword(raw);
  const deduped  = dedupe(filtered);
  const sorted   = sortByDate(deduped).slice(0, MAX_ARTICLES);

  // Busca og:image para artigos sem imagem (principalmente Google News)
  await enrichImages(sorted);

  // Aplica placeholder por categoria para os que ainda não têm imagem
  const final = sorted.map(a => {
    const { _skipFilter, ...article } = a;
    return {
      ...article,
      image:    a.image    || getPlaceholder(a.category),
      imageUrl: a.imageUrl || getPlaceholder(a.category),
    };
  });

  const withReal = final.filter(a => !Object.values(PLACEHOLDERS).includes(a.image)).length;

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify({
      meta: {
        club:        CLUB_META.id,
        lastUpdated: new Date().toISOString(),
        totalItems:  final.length,
      },
      news: final,
    }, null, 2),
    'utf-8'
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  ── Resultado ──────────────────────────────`);
  console.log(`  Artigos brutos:       ${raw.length}`);
  console.log(`  Após filtro keyword:  ${filtered.length}`);
  console.log(`  Após dedup:           ${deduped.length}`);
  console.log(`  Final publicado:      ${final.length}`);
  console.log(`  Com imagem real:      ${withReal}/${final.length}`);
  console.log(`  Tempo total:          ${elapsed}s`);
  console.log(`  ────────────────────────────────────────────\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH COM RETRY
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSource(source, attempt = 1) {
  try {
    const feed  = await parser.parseURL(source.url);
    const items = (feed.items || []).map(item => normalise(item, source));
    console.log(`  ✓ ${source.name.padEnd(38)} ${String(items.length).padStart(3)} itens`);
    return items;
  } catch (err) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1500));
      return fetchSource(source, attempt + 1);
    }
    console.warn(`  ✗ ${source.name.padEnd(38)} ${err.message.slice(0, 55)}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

function normalise(item, source) {
  const img     = getImageFromRss(item);
  const pubDate = item.isoDate
    || (item.pubDate ? new Date(item.pubDate).toISOString() : null)
    || new Date().toISOString();

  return {
    id:             slugId(item.link || item.guid || item.title),
    title:          clean(item.title),
    summary:        clean(item.contentSnippet || item.summary || '').slice(0, 320),
    content:        item['content:encoded'] || item.content || '',
    category:       source.category,
    source:         source.name,
    sourceUrl:      item.link || item.guid || '',
    image:          img,
    imageUrl:       img,
    imageAlt:       clean(item.title),
    publishedAt:    pubDate,
    featured:       false,
    relevanceScore: scoreRelevance(item),
    tags:           extractTags(item),
    _skipFilter:    source.skipKeywordFilter,
  };
}

function slugId(str) {
  return Buffer.from(String(str || Math.random())).toString('base64url').slice(0, 32);
}

function scoreRelevance(item) {
  const text = `${item.title} ${item.contentSnippet || ''}`.toLowerCase();
  let s = 0;
  if (/santos\s*fc/i.test(text))    s += 3;
  if (/peixe/i.test(text))          s += 2;
  if (/vila\s*belmiro/i.test(text)) s += 2;
  if (/neymar/i.test(text))         s += 1;
  if (/gabigol/i.test(text))        s += 1;
  if (/cuca/i.test(text))           s += 1;
  return s;
}

function extractTags(item) {
  if (!item.categories) return [];
  return item.categories.slice(0, 5).map(t => clean(String(t))).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO DE IMAGEM DO RSS
// ─────────────────────────────────────────────────────────────────────────────

function getImageFromRss(item) {
  // 1. media:content
  const mc = item['media:content'];
  if (mc) {
    for (const m of (Array.isArray(mc) ? mc : [mc])) {
      const u = m?.$?.url || m?.url;
      if (isValidImg(u)) return cleanUrl(u);
    }
  }
  // 2. media:thumbnail
  const mt = item['media:thumbnail'];
  if (mt) {
    for (const t of (Array.isArray(mt) ? mt : [mt])) {
      const u = t?.$?.url || t?.url;
      if (isValidImg(u)) return cleanUrl(u);
    }
  }
  // 3. enclosure
  if (item.enclosure?.url && isValidImg(item.enclosure.url)) {
    return cleanUrl(item.enclosure.url);
  }
  // 4. Primeira imagem no HTML do conteúdo
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]{10,})["']/i);
  if (m && isValidImg(m[1])) return cleanUrl(m[1]);

  return ''; // sem imagem no RSS — será enriquecido depois
}

function isValidImg(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  if (/\/(pixel|tracking|beacon|1x1|spacer|blank)\./i.test(url)) return false;
  if (url.length < 20) return false;
  return true;
}

function cleanUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  // Remove query string apenas se for parâmetro de tracking puro
  // (mantém params de imagem que alguns CDNs precisam)
  return u.startsWith('https://') ? u : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTROS E UTILS
// ─────────────────────────────────────────────────────────────────────────────

function filterByKeyword(articles) {
  const re = new RegExp(KEYWORDS.join('|'), 'i');
  return articles.filter(a => {
    if (a._skipFilter) return true;
    return re.test(`${a.title} ${a.summary}`);
  });
}

function dedupe(articles) {
  const seenUrls   = new Set();
  const seenTitles = new Set();
  return articles.filter(a => {
    const tk = _normalize(a.title).slice(0, 64);
    if (a.sourceUrl && seenUrls.has(a.sourceUrl))   return false;
    if (tk          && seenTitles.has(tk))           return false;
    if (a.sourceUrl) seenUrls.add(a.sourceUrl);
    if (tk)          seenTitles.add(tk);
    return true;
  });
}

function sortByDate(articles) {
  return [...articles].sort((a, b) => {
    const d = new Date(b.publishedAt) - new Date(a.publishedAt);
    return d !== 0 ? d : (b.relevanceScore || 0) - (a.relevanceScore || 0);
  });
}

function clean(str) {
  return (str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function _normalize(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
      
