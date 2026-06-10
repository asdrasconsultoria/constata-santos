import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const CLUB_META = { id: 'santos', name: 'Constata Santos' };

const KEYWORDS = [
  'Santos FC',
  'Santos Futebol Clube',
  'Peixe',              // apelido único do clube
  'Vila Belmiro',
  'Meninos da Vila',
  'Alvinegro Praiano',
  'Gabigol',
  'Cuca',
  'Miguelito',
  'Brazão',
  'Bontempo',
  'Deivid Washington',
  'Rollheiser',
  'Willian Arão',
  'Guilherme Augusto',
  'Lautaro Diaz',
  'Neymar',
];

const MAX_ARTICLES = 50;

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES — apenas portais confirmados com imagem no RSS
//
// Critério de inclusão:
//   ✓ Retornou itens no último run
//   ✓ Inclui imagem via media:content, enclosure ou content:encoded
//   ✗ Google News removido — nunca inclui imagem no RSS
//   ✗ Lance!, UOL, ESPN, Placar removidos — retornaram 404/403
//
// skipKeywordFilter:
//   true  → feed já é específico do Santos, não precisa filtrar
//   false → feed geral de futebol, filtra por keyword
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES = [

  // ── 100% dedicados ao Santos ──────────────────────────────────────────────
  {
    id:                'diario-peixe',
    name:              'Diário do Peixe',
    url:               'https://www.diariodopeixe.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'soul-santista',
    name:              'Blog Soul Santista',
    url:               'https://blogsoulsantista.com.br/feed/',
    category:          'opiniao',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'santistas-net',
    name:              'Santistas.net',
    url:               'https://santistas.net/noticias-do-santos/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },

  // ── Portais esportivos com feed Santos específico ─────────────────────────
  {
    id:                'gazeta-santos',
    name:              'Gazeta Esportiva',
    url:               'https://www.gazetaesportiva.com/times/santos/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'gazeta-tag-santos',
    name:              'Gazeta Esportiva (tag)',
    url:               'https://www.gazetaesportiva.com/tag/santos-fc/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },

  // ── Portais esportivos gerais — filtrados por keyword ─────────────────────
  {
    id:                'bolavip',
    name:              'Bolavip',
    url:               'https://br.bolavip.com/rss/feed/category/campeonato-brasileirao',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: false,
  },
  {
    id:                'noataque',
    name:              'No Ataque',
    url:               'https://www.noataque.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: false,
  },

  // ── Portais esportivos com feed Santos específico (novos) ─────────────────
  {
    id:                'lance-santos',
    name:              'Lance! Santos',
    url:               'https://www.lance.com.br/santos/feed/',
    category:          'futebol',
    enabled:           false, // XML malformado — desativado
    skipKeywordFilter: true,
  },

  // ── Portais esportivos gerais — filtrados por keyword (novos) ─────────────
  {
    id:                'trivela',
    name:              'Trivela',
    url:               'https://trivela.com.br/feed/',
    category:          'futebol',
    enabled:           false,
    skipKeywordFilter: false,
  },
  {
    id:                'futebol-interior',
    name:              'Futebol Interior',
    url:               'https://www.futebolinterior.com.br/feed/',
    category:          'futebol',
    enabled:           false, // XML inválido — desativado
    skipKeywordFilter: false,
  },
  {
    id:                'goal-brasil',
    name:              'Goal Brasil',
    url:               'https://www.goal.com/feeds/br/news',
    category:          'futebol',
    enabled:           false, // 404 — desativado
    skipKeywordFilter: false,
  },

  // ── Site oficial do Santos FC ─────────────────────────────────────────────
  {
    id:                'santosfc-oficial',
    name:              'Santos FC Oficial',
    url:               'https://www.santosfc.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },

  // ── Portais regionais com cobertura do Santos ─────────────────────────────
  {
    id:                'atribuna-santos',
    name:              'A Tribuna Santos',
    url:               'https://www.atribuna.com.br/esportes/santos-fc/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'noticias-do-peixe',
    name:              'Notícias do Peixe',
    url:               'https://noticiasdopeixe.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'santos-na-vila',
    name:              'Santos na Vila',
    url:               'https://santosnavila.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'tudo-sobre-santos',
    name:              'Tudo Sobre Santos',
    url:               'https://www.tudosobresantos.com.br/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },

  // ── Portais esportivos gerais com tag/categoria Santos ────────────────────
  {
    id:                'ge-santos',
    name:              'ge.globo Santos',
    url:               'https://ge.globo.com/santos/rss2.xml',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'uol-santos-tag',
    name:              'UOL Esporte — Santos',
    url:               'https://esporte.uol.com.br/futebol/campeonatos/brasileiro/serie-a/santos/rss2.xml',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'my-tip-santos',
    name:              'MyTip Santos',
    url:               'https://www.mytipfutebol.com.br/tag/santos/feed/',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
  {
    id:                'sambafoot-santos',
    name:              'Sambafoot Santos',
    url:               'https://www.sambafoot.com/pt/noticias/rss/santos.xml',
    category:          'futebol',
    enabled:           true,
    skipKeywordFilter: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PARSER RSS
// ─────────────────────────────────────────────────────────────────────────────

const FEED_UA = 'Mozilla/5.0 (compatible; Feedbot/1.0; +https://constatasantos.github.io)';

const parser = new RSSParser({
  timeout: 12000,
  headers: {
    'User-Agent':      FEED_UA,
    'Accept':          'application/rss+xml, application/xml, text/xml, */*',
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

  // Remove campo interno e garante que artigos sem imagem
  // ficam com string vazia (o app.js já tem fallback visual via CSS)
  const final = sorted.map(a => {
    const { _skipFilter, ...article } = a;
    return article;
  });

  const withImg = final.filter(a => a.image).length;

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
  console.log(`  Com imagem real:      ${withImg}/${final.length}`);
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
    console.log(`  ✓ ${source.name.padEnd(30)} ${String(items.length).padStart(3)} itens`);
    return items;
  } catch (err) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1500));
      return fetchSource(source, attempt + 1);
    }
    console.warn(`  ✗ ${source.name.padEnd(30)} ${err.message.slice(0, 60)}`);
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
  // 4. Primeira <img> no HTML do conteúdo
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]{10,})["']/i);
  if (m && isValidImg(m[1])) return cleanUrl(m[1]);

  return '';
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

