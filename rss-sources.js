// =============================================================================
// rss-sources.js
// Club-specific configuration for the news collection pipeline.
//
// WHITE-LABEL USAGE:
//   This is the ONLY file that changes between club deployments.
//   fetch-news.js reads this file and has zero club-specific logic.
//
//   To deploy for a new club:
//     1. Replace CLUB_META with the new club's info
//     2. Replace KEYWORDS with the new club's terms
//     3. Replace SOURCES with the new club's feeds
//     fetch-news.js stays untouched.
// =============================================================================


// -----------------------------------------------------------------------------
// CLUB META
// -----------------------------------------------------------------------------
export const CLUB_META = {
  id:      'santos',
  name:    'Santos FC',
  country: 'BR',
  league:  'Brasileirao',
};


// -----------------------------------------------------------------------------
// KEYWORDS
// Articles matching at least one keyword are kept; others are discarded.
// Checked against title + summary + content (case-insensitive).
// -----------------------------------------------------------------------------
export const KEYWORDS = [
  'Santos',
  'Santos FC',
  'Vila Belmiro',
  'Peixe',
  'Alvinegro Praiano',
  'CT Rei Pelé',
];


// -----------------------------------------------------------------------------
// SOURCES
//
// IMPLEMENTED type:
//   'rss' — fetched and parsed by fetch-news.js
//
// RESERVED types (log a warning if used before implemented):
//   'blog' | 'youtube' | 'document' | 'social'
//
// FIELDS:
//   id        — unique slug for deduplication and logging
//   type      — source type (see above)
//   name      — human-readable label shown in the portal
//   url       — RSS feed endpoint
//   category  — default category assigned to articles from this source
//   language  — reserved for future translation layer
//   enabled   — false = paused without deleting; true = active
//   note      — optional explanation, shown only in this file
//
// ESTIMATED DAILY VOLUME (current season, Santos in 3 competitions):
//   ge-santos            8–15 articles/day   (dedicated Santos feed)
//   gazeta-santos        5–10 articles/day   (dedicated Santos feed)
//   atribuna-santos      4–8  articles/day   (local coverage, bastidores)
//   lance-santos         5–10 articles/day   (general feed, keyword-filtered)
//   santos-fc-oficial    1–3  articles/day   (official club communications)
//   uol-esporte          2–4  articles/day   (broad feed, low Santos density)
//   transfermarkt        0    articles/day   (disabled — URL unconfirmed)
//
//   TOTAL ESTIMATED: 25–50 articles/day on regular days
//                    40–70 articles/day on match days
// -----------------------------------------------------------------------------
export const SOURCES = [

  // ── Tier 1: dedicated Santos feeds ─────────────────────────────────────────
  // High approval rate after keyword filter. Primary sources.

  {
    id:       'ge-santos',
    type:     'rss',
    name:     'ge.globo',
    url:      'https://ge.globo.com/rss/santos/',
    category: 'Futebol',
    language: 'pt',
    enabled:  true,
  },

  {
    id:       'gazeta-santos',
    type:     'rss',
    name:     'Gazeta Esportiva',
    url:      'https://www.gazetaesportiva.com/times/santos/feed/',
    category: 'Futebol',
    language: 'pt',
    enabled:  true,
  },

  {
    id:       'atribuna-santos',
    type:     'rss',
    name:     'A Tribuna',
    url:      'https://www.atribuna.com.br/esportes/santos-fc/feed/',
    category: 'Bastidores',
    language: 'pt',
    enabled:  true,
    note:     'Local Baixada Santista paper. Best source for CT, squad and institutional news.',
  },

  // ── Tier 2: general feeds with keyword filtering ────────────────────────────
  // Lower Santos density. Keyword filter does most of the work here.

  {
    id:       'lance-santos',
    type:     'rss',
    name:     'Lance!',
    url:      'https://www.lance.com.br/santos.xml',
    category: 'Futebol',
    language: 'pt',
    enabled:  true,
  },

  {
    id:       'santos-fc-oficial',
    type:     'rss',
    name:     'Santos FC Oficial',
    url:      'https://www.santosfc.com.br/feed/',
    category: 'Institucional',
    language: 'pt',
    enabled:  true,
  },

  {
    id:       'uol-esporte',
    type:     'rss',
    name:     'UOL Esporte',
    url:      'https://esporte.uol.com.br/futebol/campeonatos/brasileiro/rss.xml',
    category: 'Futebol',
    language: 'pt',
    enabled:  true,
    note:     'General Brasileirao feed. Low Santos density — keyword filter required.',
  },

  // ── Tier 3: disabled — pending URL confirmation ─────────────────────────────

  {
    id:       'transfermarkt-santos',
    type:     'rss',
    name:     'Transfermarkt',
    url:      'https://www.transfermarkt.com.br/santos-fc/rss/verein/877',
    category: 'Transferências',
    language: 'pt',
    enabled:  false,
    note:     'Enable after confirming feed URL is active.',
  },

];
