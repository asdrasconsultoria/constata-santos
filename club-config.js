/**
 * CONSTATA PRESS — Club Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the only file that needs to change when launching a new club portal.
 * Do not hardcode any of these values anywhere else in the application.
 *
 * White-label checklist for a new club:
 *   1. Update CLUB identity fields (name, shortName, clubSlug, founded, city, country)
 *   2. Replace logo path or URL
 *   3. Update COLORS (CSS custom property values)
 *   4. Replace KEYWORDS used to filter and tag news
 *   5. Replace RSS_SOURCES with the club's relevant feeds
 *   6. Update META for SEO and social sharing
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CLUB_CONFIG = {

  // ── Identity ───────────────────────────────────────────────────────────────
  club: {
    id:         "santos-fc",
    clubSlug:   "santos",          // URL-safe identifier — used in routes, filenames, API paths
    name:       "Santos FC",
    shortName:  "Santos",
    nickname:   "Peixe",
    founded:    1912,
    city:       "Santos",
    state:      "SP",
    country:    "Brasil",
    league:     "Brasileirão Série B",
    logoUrl:    "assets/logo-santos.svg",   // Replace with club logo path or CDN URL
    siteTitle:  "Constata Santos",
    tagline:    "Informação. Contexto. Santos FC.",
  },

  // ── Visual Identity ────────────────────────────────────────────────────────
  // These values are injected as CSS custom properties at runtime.
  // Changing them here changes the entire visual theme.
  colors: {
    accent:         "#D4A017",   // Muted gold — primary accent
    accentHover:    "#B8890F",   // Gold darker — hover state
    accentMuted:    "rgba(212, 160, 23, 0.08)", // Gold tint — subtle backgrounds
    surface:        "#F8F8F6",   // Off-white — main background
    surfaceRaised:  "#FFFFFF",   // White — cards, panels
    surfaceBorder:  "#E5E5E5",   // Light gray — borders
    textPrimary:    "#111111",   // Near-black — main text
    textSecondary:  "#555555",   // Mid gray — secondary text
    textMuted:      "#999999",   // Light gray — metadata, placeholders
  },

  // ── News Data Source ───────────────────────────────────────────────────────
  // The frontend fetches this file. The process that writes it is irrelevant
  // to the frontend — it may be RSS aggregation, an API, a CMS, a Netlify
  // Function, a cron job, or manual editing. The contract is the JSON schema.
  dataSource: {
    newsFile: "/constata-santos/noticias.json",
    refreshInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes (ms)
    cacheKey:        "constata_santos_news_cache",
    cacheMaxAge:     10 * 60 * 1000, // Cache valid for 10 minutes (ms)
  },

  // ── Content Categories ─────────────────────────────────────────────────────
  // Used to filter, tag, and color-code news cards.
  categories: [
    { id: "all",          label: "Tudo"           },
    { id: "futebol",      label: "Futebol"         },
    { id: "transferencia",label: "Transferências"  },
    { id: "bastidores",   label: "Bastidores"      },
    { id: "financeiro",   label: "Financeiro"      },
    { id: "institucional",label: "Institucional"   },
    { id: "opiniao",      label: "Opinião"         },
  ],

  // ── Keywords ───────────────────────────────────────────────────────────────
  // Used by future automation to filter RSS items relevant to this club.
  // Not used directly by the frontend rendering logic.
  keywords: {
    primary: [
      "Santos FC",
      "Santos Futebol Clube",
      "Peixe",
      "Vila Belmiro",
    ],
    secondary: [
      "Brasileirão",
      "CBF",
      "Santos x",
      "x Santos",
    ],
    exclude: [
      "Santos (AP)",     // City in Amapá — not the club
      "Santos Dumont",   // Airport / inventor — not the club
    ],
  },

  // ── RSS Sources ────────────────────────────────────────────────────────────
  // Used exclusively by the future news automation pipeline.
  // The frontend never reads this — it only consumes noticias.json.
  // Defined here so the pipeline configuration stays in one place per club.
  rssSources: [
    {
      name:     "ge.globo — Santos",
      url:      "https://ge.globo.com/rss/santos/",
      language: "pt-BR",
      priority: 1,
    },
    {
      name:     "UOL Esporte — Santos",
      url:      "https://esporte.uol.com.br/futebol/campeonatos/brasileiro/rss.xml",
      language: "pt-BR",
      priority: 2,
    },
    {
      name:     "Gazeta Esportiva — Santos",
      url:      "https://www.gazetaesportiva.com/feed/",
      language: "pt-BR",
      priority: 3,
    },
    {
      name:     "Santos FC Oficial",
      url:      "https://www.santosfc.com.br/feed/",
      language: "pt-BR",
      priority: 1,
    },
  ],

  // ── SEO & Meta ─────────────────────────────────────────────────────────────
  meta: {
    description: "Constata Santos — monitoramento, contextualização e análise de informações sobre o Santos FC.",
    ogImage:     "assets/og-image.jpg",
    twitterCard: "summary_large_image",
    lang:        "pt-BR",
    locale:      "pt_BR",
  },

  // ── Feature Flags ──────────────────────────────────────────────────────────
  // Controls which UI sections are visible. Sections set to false render as
  // "coming soon" placeholders, keeping the layout stable for future releases.
  features: {
    search:           true,
    categories:       true,
    featuredStory:    true,
    nextMatch:        false,  // Requires football data integration
    analysis:         false,  // Future release
    indicators:       false,  // Future release
    timeline:         false,  // Future release
    premiumContent:   false,  // Subscription system — future release
    premiumEnabled:   false,  // Master switch — enables all premium-gated UI
    indicatorsEnabled:false,  // Master switch — enables governance/financial indicators
  },

  // ── Platform Version ───────────────────────────────────────────────────────
  // Increment on breaking schema changes so cached data can be invalidated.
  version: "1.0.0",

};

// Freeze the config to prevent accidental mutation at runtime
Object.freeze(CLUB_CONFIG);
Object.freeze(CLUB_CONFIG.club);
Object.freeze(CLUB_CONFIG.colors);
Object.freeze(CLUB_CONFIG.dataSource);
Object.freeze(CLUB_CONFIG.features);
