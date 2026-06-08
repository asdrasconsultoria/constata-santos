import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../noticias.json');

const CLUB_META = { id: 'santos', name: 'Constata Santos' };
const KEYWORDS = ['Santos', 'Peixe', 'Vila Belmiro', 'Alvinegro', 'Santos FC'];
const MAX_ARTICLES = 40;

const SOURCES = [
  { id: 'santos-oficial', name: 'Santos FC', url: 'https://www.santosfc.com.br/feed/', category: 'oficial', enabled: true },
  { id: 'ge-santos', name: 'ge', url: 'https://globoesporte.globo.com/futebol/times/santos/rss2.xml', category: 'midia', enabled: true },
  { id: 'gazeta', name: 'Gazeta', url: 'https://www.gazetaesportiva.com/times/santos/feed/', category: 'midia', enabled: true },
  { id: 'diario', name: 'Diário do Peixe', url: 'https://www.diariodopeixe.com.br/feed/', category: 'blog', enabled: true },
  { id: 'uol', name: 'UOL', url: 'https://rss.uol.com.br/feed/esporte.xml', category: 'midia', enabled: true },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com.br/espn/rss/news', category: 'midia', enabled: true },
  { id: '90min', name: '90min', url: 'https://www.90min.com/pt-BR/teams/santos-fc/feed', category: 'midia', enabled: true },
  { id: 'bolavip', name: 'Bolavip', url: 'https://br.bolavip.com/rss/santos-fc.xml', category: 'midia', enabled: true },
  { id: 'torcedores', name: 'Torcedores', url: 'https://www.torcedores.com/times/santos/feed', category: 'blog', enabled: true },
  { id: 'atribuna', name: 'A Tribuna', url: 'https://www.atribuna.com.br/rss/esportes.xml', category: 'regional', enabled: true },
];

const parser = new RSSParser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0' },
  customFields: { item: [['media:content', 'media:content', {keepArray:true}], ['enclosure','enclosure']] }
});

async function main() {
  console.log(`\n[${CLUB_META.name}] Buscando de ${SOURCES.filter(s=>s.enabled).length} fontes...`);
  const start = Date.now();
  
  const results = await Promise.allSettled(
    SOURCES.filter(s=>s.enabled).map(async s => {
      try {
        const feed = await parser.parseURL(s.url);
        return feed.items.map(i => ({
          id: Buffer.from(i.link||i.guid).toString('base64url'),
          title: (i.title||'').replace(/<[^>]*>/g,''),
          summary: (i.contentSnippet||'').replace(/<[^>]*>/g,'').substring(0,200),
          source: s.name,
          sourceUrl: i.link,
          imageUrl: extractImg(i),
          publishedAt: i.isoDate || new Date().toISOString(),
          category: s.category,
        }));
      } catch(e) { console.log(`  ✗ ${s.name}`); return []; }
    })
  );
  
  const articles = results.flatMap(r=>r.value||[])
    .filter(a => new RegExp(KEYWORDS.join('|'),'i').test(a.title))
    .sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt))
    .slice(0, MAX_ARTICLES);
  
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({
    meta: { lastUpdated: new Date().toISOString(), total: articles.length },
    news: articles
  }, null, 2));
  
  console.log(`✓ ${articles.length} notícias salvas em ${((Date.now()-start)/1000).toFixed(1)}s`);
}

function extractImg(i) {
  const mc = i['media:content']?.[0];
  if (mc?.['$']?.url) return mc['$'].url;
  if (i.enclosure?.url) return i.enclosure.url;
  const m = (i.content||'').match(/<img[^>]+src="([^"]+)"/);
  return m ? m[1] : '';
}

main().catch(console.error);
