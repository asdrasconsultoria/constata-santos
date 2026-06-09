import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const CLUB_META = { id: 'santos', name: 'Constata Santos' };

// Keywords para filtrar artigos relevantes ao Santos FC
const KEYWORDS = [
  'Santos', 'Peixe', 'Vila Belmiro', 'Santos FC',
  'Neymar', 'Gabigol', 'Cuca', 'Miguelito',
  'Brazão', 'Bontempo', 'Deivid', 'Soteldo',
];

const MAX_ARTICLES = 40;

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES
//
// Estratégia de RSS por camada de confiabilidade:
//
//  Camada 1 — Google News RSS (sem bloqueio, agrega todos os portais brasileiros)
//             Busca por termos específicos do Santos FC.
//             É a fonte mais confiável e sempre funciona.
//
//  Camada 2 — Sites dedicados ao Santos (Diário do Peixe, Soul Santista, Santistas)
//             Confirmados ativos pelo Feedspot em 2026.
//
//  Camada 3 — Grandes portais esportivos brasileiros com RSS público
//             (Gazeta Esportiva, Lance!, Placar, Trivela)
//             Exigem filtro por keyword pois são feeds gerais de futebol.
//
//  Camada 4 — Santos FC Oficial
//             Feed próprio do clube — às vezes bloqueia scrapers,
//             por isso fica habilitado mas com fallback silencioso.
//
// Como testar manualmente se um feed está vivo:
//   curl -sL -A "Feedbot/1.0" "URL_DO_FEED" | head -c 500
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES = [

  // ── Camada 1: Google News RSS — sempre funciona, agrega tudo ──────────────
  // O Google News não bloqueia bots com User-Agent de feed.
  // Cada URL é uma busca diferente para maximizar cobertura.
  {
    id: 'gnews-santos-fc',
    name: 'Google News — Santos FC',
    url: 'https://news.google.com/rss/search?q=%22Santos+FC%22&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true, // já é uma busca específica
  },
  {
    id: 'gnews-santos-peixe',
    name: 'Google News — Peixe / Vila Belmiro',
    url: 'https://news.google.com/rss/search?q=%22Santos%22+%22Peixe%22+futebol&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'gnews-neymar-santos',
    name: 'Google News — Neymar Santos',
    url: 'https://news.google.com/rss/search?q=Neymar+Santos&hl=pt-BR&gl=BR&ceid=BR:pt-419',
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
    name: 'Google News — Santos transferências',
    url: 'https://news.google.com/rss/search?q=%22Santos+FC%22+transfer%C3%AAncias+OR+contrato+OR+refor%C3%A7o&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    category: 'mercado',
    enabled: true,
    skipKeywordFilter: true,
  },

  // ── Camada 2: Sites 100% dedicados ao Santos ───────────────────────────────
  {
    id: 'diario-peixe',
    name: 'Diário do Peixe',
    // URL confirmada pelo Feedspot 2026. Site ativo com 65k seguidores no Twitter.
    url: 'https://www.diariodopeixe.com.br/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'soul-santista',
    name: 'Blog Soul Santista',
    // URL confirmada pelo Feedspot 2026 — blogsoulsantista.com.br/feed
    url: 'https://blogsoulsantista.com.br/feed/',
    category: 'opiniao',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'santistas-net',
    name: 'Santistas.net',
    // URL parcial do Feedspot: santistas.net/noticias-do-sa..
    // URL completa inferida como padrão WordPress /feed/
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

  // ── Camada 3: Grandes portais esportivos brasileiros ──────────────────────
  {
    id: 'gazeta-santos',
    name: 'Gazeta Esportiva',
    // Feed da categoria Santos — confirmado existente pelo site deles (/feedrss/)
    url: 'https://www.gazetaesportiva.com/times/santos/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'gazeta-tag-santos',
    name: 'Gazeta Esportiva (tag)',
    // Feed alternativo por tag
    url: 'https://www.gazetaesportiva.com/tag/santos-fc/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'lance',
    name: 'Lance!',
    // Lance! tem RSS público geral — filtramos por keyword
    url: 'https://www.lance.com.br/santos.html?format=feed&type=rss',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: true,
  },
  {
    id: 'lance-feed',
    name: 'Lance! (feed geral)',
    url: 'https://www.lance.com.br/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false, // precisa filtrar — é feed geral
  },
  {
    id: 'placar',
    name: 'Placar',
    // Confirmado ativo pelo Feedspot 2026 — 1.8M seguidores no Facebook
    url: 'https://placar.com.br/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
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
    id: 'uol-esporte',
    name: 'UOL Esporte',
    url: 'https://rss.uol.com.br/feed/esportes.xml',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'futebol-interior',
    name: 'Futebol Interior',
    // Confirmado ativo pelo Feedspot — 151k seguidores no Facebook
    url: 'https://www.futebolinterior.com.br/feed/',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'bolavip-brasileirao',
    name: 'Bolavip',
    // URL correta do Feedspot 2026 — feed do Brasileirão
    url: 'https://br.bolavip.com/rss/feed/category/campeonato-brasileirao',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'atribuna',
    name: 'A Tribuna (Santos)',
    // Jornal de Santos — cobertura local
    url: 'https://www.atribuna.com.br/rss/esportes.xml',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
  {
    id: 'espn-brasil',
    name: 'ESPN Brasil',
    url: 'https://www.espn.com.br/espn/rss/news',
    category: 'futebol',
    enabled: true,
    skipKeywordFilter: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO PARSER
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT = 12000;

// User-Agent que imita um leitor de feed legítimo — menos bloqueios
const FEED_USER_AGENT = 'Mozilla/5.0 (compatible; Feedbot/1.0; +https://constatasantos.github.io)';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&h=400&fit=crop';

const parser = new RSSParser({
  timeout: FETCH_TIMEOUT,
  headers: {
    'User-Agent': FEED_USER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Cache-Control': 'no-cache',
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
  console.log(`  Fontes habilitadas: ${enabled.length}`);

  const results = await Promise.allSettled(
    enabled.map(source => fetchSource(source))
  );

  const raw = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Filtra por keyword apenas nas fontes que não são específicas do Santos
  const filtered = filterByKeyword(raw);

  const deduped = dedupe(filtered);
  const sorted  = sortByDate(deduped).slice(0, MAX_ARTICLES);
  const final   = sorted.map(a => ({
    ...a,
    image:    a.image    || PLACEHOLDER,
    imageUrl: a.imageUrl || PLACEHOLDER,
  }));

  const withImg = final.filter(a => a.image !== PLACEHOLDER).length;

  const output = {
    meta: {
      club:        CLUB_META.id,
      lastUpdated: new Date().toISOString(),
      totalItems:  final.length,
    },
    news: final,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n  ── Resultado ──────────────────────────────`);
  console.log(`  Artigos brutos:    ${raw.length}`);
  console.log(`  Após filtro:       ${filtered.length}`);
  console.log(`  Após dedup:        ${deduped.length}`);
  console.log(`  Final publicado:   ${final.length}`);
  console.log(`  Com imagem real:   ${withImg}/${final.length}`);
  console.log(`  Tempo total:       ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`  Arquivo:           ${OUTPUT_PATH}`);
  console.log(`  ────────────────────────────────────────────\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH COM RETRY
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSource(source, attempt = 1) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).map(item => normalise(item, source));
    console.log(`  ✓ ${source.name.padEnd(30)} ${items.length} itens`);
    return items;
  } catch (err) {
    if (attempt < 2) {
      // Uma segunda tentativa após 1s
      await new Promise(r => setTimeout(r, 1000));
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
  const img = getImage(item);
  const pubDate = item.isoDate
    || (item.pubDate ? new Date(item.pubDate).toISOString() : null)
    || new Date().toISOString();

  return {
    id:          Buffer.from(item.link || item.guid || item.title || Math.random().toString()).toString('base64url'),
    title:       clean(item.title),
    summary:     clean(item.contentSnippet || item.summary || item['content:encoded'] || '').slice(0, 300),
    content:     item['content:encoded'] || item.content || '',
    category:    source.category,
    source:      source.name,
    sourceUrl:   item.link || item.guid || '',
    image:       img,
    imageUrl:    img,
    imageAlt:    clean(item.title),
    publishedAt: pubDate,
    featured:    false,
    relevanceScore: scoreRelevance(item),
    tags:        extractTags(item),
    // Flag interna para controle de filtro
    _skipFilter: source.skipKeywordFilter,
  };
}

// Pontuação de relevância para priorizar artigos mais relevantes ao Santos
function scoreRelevance(item) {
  const text = `${item.title} ${item.contentSnippet || ''}`.toLowerCase();
  let score = 0;
  if (/santos\s*fc/i.test(text))    score += 3;
  if (/peixe/i.test(text))          score += 2;
  if (/vila\s*belmiro/i.test(text)) score += 2;
  if (/neymar/i.test(text))         score += 1;
  if (/gabigol/i.test(text))        score += 1;
  if (/cuca/i.test(text))           score += 1;
  return score;
}

function extractTags(item) {
  const tags = [];
  if (item.categories) tags.push(...item.categories.slice(0, 5));
  return tags.map(t => clean(String(t))).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO DE IMAGEM
// ─────────────────────────────────────────────────────────────────────────────

function getImage(item) {
  // 1. media:content
  const mc = item['media:content'];
  if (mc) {
    for (const m of (Array.isArray(mc) ? mc : [mc])) {
      const url = m?.$?.url || m?.url || m;
      if (isValidImg(url)) return cleanUrl(url);
    }
  }

  // 2. media:thumbnail
  const mt = item['media:thumbnail'];
  if (mt) {
    for (const t of (Array.isArray(mt) ? mt : [mt])) {
      const url = t?.$?.url || t?.url || t;
      if (isValidImg(url)) return cleanUrl(url);
    }
  }

  // 3. enclosure
  if (item.enclosure?.url && isValidImg(item.enclosure.url)) {
    return cleanUrl(item.enclosure.url);
  }

  // 4. Primeira imagem no HTML do conteúdo
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)/i);
  if (m && isValidImg(m[1])) return cleanUrl(m[1]);

  return '';
}

function isValidImg(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  // Ignora ícones e imagens de tracking pequenas
  if (/\/(s|pixel|tracking|beacon|1x1|spacer)\./i.test(url)) return false;
  return true;
}

function cleanUrl(url) {
  if (!url) return '';
  // Remove query string que pode causar problemas de CORS
  let u = url.split('?')[0];
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = u.replace('http://', 'https://');
  return u.startsWith('https://') ? u : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTROS
// ─────────────────────────────────────────────────────────────────────────────

function filterByKeyword(articles) {
  const re = new RegExp(KEYWORDS.join('|'), 'i');
  return articles.filter(a => {
    // Fontes específicas do Santos pulam o filtro
    if (a._skipFilter) return true;
    return re.test(`${a.title} ${a.summary}`);
  });
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter(a => {
    // Deduplica por URL e por título normalizado (captura variações de URL)
    const titleKey = _normalize(a.title).slice(0, 60);
    const urlKey   = a.sourceUrl;

    if (!urlKey && !titleKey) return false;

    // Checa URL
    if (urlKey && seen.has(urlKey)) return false;

    // Checa título (artigo muito semelhante de fontes diferentes)
    if (titleKey && seen.has(titleKey)) return false;

    if (urlKey)   seen.add(urlKey);
    if (titleKey) seen.add(titleKey);
    return true;
  });
}

function sortByDate(articles) {
  return [...articles].sort((a, b) => {
    const dateSort = new Date(b.publishedAt) - new Date(a.publishedAt);
    if (dateSort !== 0) return dateSort;
    // Desempate por relevância
    return (b.relevanceScore || 0) - (a.relevanceScore || 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function clean(str) {
  return (str || '')
    .replace(/<[^>]*>/g, '')      // remove HTML
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function _normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
      
