import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const CLUB_META = { id: 'santos', name: 'Constata Santos' };
const KEYWORDS = ['Santos Futebol Clube', 'Meninos da Vila', 'Peixe', 'Vila Belmiro', 'Menino da Vila','Santos FC'];
const SOURCES = [
  // OFICIAIS (sempre tem imagem)
  {
    id: 'santos-oficial',
    name: 'Santos FC Oficial',
    url: 'https://www.santosfc.com.br/feed/',
    category: 'futebol',
    enabled: true,
  },
  {
    id: 'ge-santos',
    name: 'ge.globo Santos',
    url: 'https://ge.globo.com/futebol/times/santos/rss2.xml',
    category: 'futebol',
    enabled: true,
  },
  
  // ESPORTIVAS (filtram por Santos)
  {
    id: 'gazeta-santos',
    name: 'Gazeta Esportiva',
    url: 'https://www.gazetaesportiva.com/times/santos/feed/',
    category: 'futebol',
    enabled: true,
  },
  {
    id: 'lance-santos',
    name: 'LANCE! Santos',
    url: 'https://www.lance.com.br/rss/santos.xml',
    category: 'futebol',
    enabled: true,
  },
  {
    id: 'espn-santos',
    name: 'ESPN Santos',
    url: 'https://www.espn.com.br/espn/rss/news',
    category: 'futebol',
    enabled: true, // vai filtrar por keyword
  },
  {
    id: 'uol-santos',
    name: 'UOL Santos',
    url: 'https://www.uol.com.br/esporte/ultimas/?rss',
    category: 'futebol',
    enabled: true,
  },
  
  // BLOGS SANTISTAS
  {
    id: 'diario-peixe',
    name: 'Diário do Peixe',
    url: 'https://www.diariodopeixe.com.br/feed/',
    category: 'futebol',
    enabled: true,
  },
  {
    id: 'meu-peixao',
    name: 'Meu Peixão',
    url: 'https://meupeixao.com.br/feed/',
    category: 'futebol',
    enabled: false, // teste primeiro
  },
];

const MAX_ARTICLES = 30;
const FETCH_TIMEOUT = 8000;
const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const PLACEHOLDER = 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&h=400&fit=crop';

const parser = new RSSParser({
  timeout: FETCH_TIMEOUT,
  headers: { 'User-Agent': BROWSER_AGENT },
  customFields: { item: [['media:content', 'media:content', { keepArray: true }], ['media:thumbnail', 'media:thumbnail', { keepArray: true }], ['enclosure', 'enclosure'], ['content:encoded', 'content:encoded']] },
});

async function main() {
  console.log(`\n[${CLUB_META.name}] Iniciando...`);
  const start = Date.now();
  const enabled = SOURCES.filter(s => s.enabled);
  const results = await Promise.allSettled(enabled.map(async (source) => {
    try {
      const feed = await parser.parseURL(source.url);
      console.log(`  ✓ ${source.name} — ${feed.items.length} itens`);
      return feed.items.map(item => normalise(item, source));
    } catch (err) {
      console.warn(`  ✗ ${source.name} — ${err.message}`);
      return [];
    }
  }));
  const raw = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const filtered = filterByKeyword(raw);
  const deduped = dedupe(filtered);
  const sorted = sortByDate(deduped).slice(0, MAX_ARTICLES);
  const final = sorted.map(a => ({ ...a, imageUrl: a.imageUrl || PLACEHOLDER, image: a.image || PLACEHOLDER }));
  const withImg = final.filter(a => a.imageUrl !== PLACEHOLDER).length;
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ meta: { club: CLUB_META.id, lastUpdated: new Date().toISOString(), totalItems: final.length }, news: final }, null, 2));
  console.log(`\n  Total: ${raw.length} → Final: ${final.length}`);
  console.log(`  Com imagens: ${withImg}/${final.length}`);
  console.log(`  ✓ Concluído em ${((Date.now()-start)/1000).toFixed(1)}s\n`);
}

function normalise(item, source) {
  const img = getImage(item);
  return {
    id: Buffer.from(item.link || item.guid || item.title).toString('base64url').slice(0, 20),
    title: clean(item.title),
    summary: clean(item.contentSnippet || item.summary || ''),
    content: item['content:encoded'] || item.content || '',
    category: source.category,
    source: source.name,
    sourceUrl: item.link || item.guid || '',
    image: img,
    imageUrl: img,
    imageAlt: clean(item.title),
    publishedAt: item.isoDate || new Date(item.pubDate).toISOString(),
    featured: false,
    relevanceScore: 0,
    tags: [],
  };
}

function getImage(item) {
  const mc = item['media:content'];
  if (mc) {
    for (const m of (Array.isArray(mc) ? mc : [mc])) {
      const url = m?.$?.url || m?.url || m;
      if (url && typeof url === 'string' && url.startsWith('http')) return cleanUrl(url);
    }
  }
  const mt = item['media:thumbnail'];
  if (mt) {
    for (const t of (Array.isArray(mt) ? mt : [mt])) {
      const url = t?.$?.url || t?.url || t;
      if (url && typeof url === 'string' && url.startsWith('http')) return cleanUrl(url);
    }
  }
  if (item.enclosure?.url) return cleanUrl(item.enclosure.url);
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)/i);
  if (m) return cleanUrl(m[1]);
  return '';
}

function cleanUrl(url) {
  if (!url) return '';
  let u = url.split('?')[0];
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = u.replace('http://', 'https://');
  return u.startsWith('https://') ? u : '';
}

function clean(str) { return (str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function filterByKeyword(articles) { if (!KEYWORDS.length) return articles; const re = new RegExp(KEYWORDS.join('|'), 'i'); return articles.filter(a => re.test(`${a.title} ${a.summary}`)); }
function dedupe(articles) { const seen = new Set(); return articles.filter(a => { if (!a.sourceUrl || seen.has(a.sourceUrl)) return false; seen.add(a.sourceUrl); return true; }); }
function sortByDate(articles) { return [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)); }

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
