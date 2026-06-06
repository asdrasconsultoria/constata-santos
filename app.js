/**
 * CONSTATA PRESS — Application Core
 * app.js v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture overview:
 *
 *   1. Config       — reads CLUB_CONFIG (club-config.js must load first)
 *   2. State        — single source of truth for all runtime data
 *   3. Data         — fetch + cache layer for noticias.json
 *   4. Render       — pure functions: data in, DOM mutations out
 *   5. Events       — delegated listeners, keyboard, modal lifecycle
 *   6. Search       — real-time filtering over in-memory article index
 *   7. Categories   — dynamic tab generation + filter logic
 *   8. Modal        — open/close/focus management
 *   9. Init         — orchestrates startup sequence
 *  10. Hooks        — stubs for future features (premium, indicators, etc.)
 *
 * Data flow:
 *   noticias.json → State.articles → filter/search → render cards
 *
 * This file never modifies club-config.js or noticias.json.
 * It reads both and produces DOM output only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ============================================================================
   1. CONFIG GUARD
   Ensure club-config.js loaded before this script executes.
   ============================================================================ */

if (typeof CLUB_CONFIG === 'undefined') {
  console.error('[Constata] CLUB_CONFIG not found. Ensure club-config.js loads before app.js.');
}

const Config = CLUB_CONFIG;


/* ============================================================================
   2. STATE
   Single mutable object. Never spread or replace — mutate in place.
   All render functions read from here.
   ============================================================================ */

const State = {
  // Raw data from noticias.json
  articles:       [],           // full article objects sorted by publishedAt desc
  lastUpdated:    null,         // ISO string from meta.lastUpdated
  totalItems:     0,            // from meta.totalItems (used for display)

  // UI state
  activeCategory: 'all',        // matches a category id in CLUB_CONFIG.categories
  searchQuery:    '',           // current search string (trimmed, lowercase)
  activeArticleId: null,        // id of the article currently open in modal
  isModalOpen:    false,
  isLoading:      true,
  hasError:       false,

  // Internal cache
  _cache:         null,         // { data, timestamp } — in-memory fetch cache
  _refreshTimer:  null,         // setInterval handle for auto-refresh

  // Derived: filtered view (recalculated on every filter/search change)
  get filtered() {
    return State._applyFilters(State.articles);
  },

  _applyFilters(articles) {
    let result = articles;

    // Category filter
    if (State.activeCategory !== 'all') {
      result = result.filter(a => a.category === State.activeCategory);
    }

    // Search filter — title, summary, content
    if (State.searchQuery.length > 0) {
      const q = State.searchQuery;
      result = result.filter(a =>
        _searchText(a.title,   q) ||
        _searchText(a.summary, q) ||
        _searchText(a.content, q)
      );
    }

    return result;
  }
};


/* ============================================================================
   3. DATA LAYER
   Fetch, cache and auto-refresh noticias.json.
   The pipeline that writes this file is irrelevant to this module.
   ============================================================================ */

const Data = {

  /**
   * Primary fetch. Returns parsed JSON or throws.
   * Uses in-memory cache keyed by maxAge from Config.dataSource.cacheMaxAge.
   */
  async load() {
    const now    = Date.now();
    const maxAge = Config.dataSource.cacheMaxAge;
    const cached = State._cache;

    // Serve from memory cache if fresh
    if (cached && (now - cached.timestamp) < maxAge) {
      return cached.data;
    }

    const url = Config.dataSource.newsFile;
    // Fetch without query-string cache-bust — Netlify CDN handles caching correctly
    // via response headers. A ?v= suffix on a static JSON file can cause Netlify to
    // serve its 404 page (HTML) instead of the file, breaking res.json().
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`[Constata] HTTP ${res.status} fetching ${url}. Check that noticias.json is deployed.`);
    }

    // Guard against Netlify returning an HTML 404 page with a 200-ish status
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json') && !contentType.includes('javascript')) {
      const body = await res.text();
      throw new Error(`[Constata] Expected JSON but got "${contentType}" from ${url}. First 100 chars: ${body.slice(0, 100)}`);
    }

    const data = await res.json();

    // Validate schema version compatibility
    if (data._schema && data._schema.version) {
      const schemaVersion = data._schema.version;
      if (schemaVersion !== Config.version) {
        console.warn(`[Constata] Schema version mismatch: config=${Config.version}, data=${schemaVersion}`);
      }
    }

    // Store in memory cache
    State._cache = { data, timestamp: now };

    return data;
  },

  /**
   * Parse the raw JSON payload into State.
   * Sorts articles by publishedAt descending.
   */
  ingest(payload) {
    if (!payload || !Array.isArray(payload.news)) {
      throw new Error('[Constata] Invalid noticias.json structure.');
    }

    State.articles    = [...payload.news].sort(_sortByDate);
    State.lastUpdated = payload.meta?.lastUpdated || null;
    State.totalItems  = payload.meta?.totalItems  || payload.news.length;
    State.isLoading   = false;
    State.hasError    = false;
  },

  /**
   * Start the auto-refresh interval.
   * On each tick: fetch silently, ingest, re-render feed + metadata.
   * If the data hasn't changed (same lastUpdated), skip re-render.
   */
  startRefresh() {
    if (State._refreshTimer) clearInterval(State._refreshTimer);

    State._refreshTimer = setInterval(async () => {
      try {
        // Force bypass cache on scheduled refresh
        State._cache = null;
        const payload  = await Data.load();
        const newStamp = payload.meta?.lastUpdated;

        // Only re-render if data actually changed
        if (newStamp && newStamp === State.lastUpdated) return;

        Data.ingest(payload);
        Render.feed();
        Render.metadata();
        Render.statusDot('live');
        console.info(`[Constata] Feed refreshed at ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        console.warn('[Constata] Silent refresh failed:', err.message);
        Render.statusDot('stale');
      }
    }, Config.dataSource.refreshInterval);
  }
};


/* ============================================================================
   4. RENDER
   Pure-ish functions: read State, write DOM.
   Each function is responsible for one section only.
   ============================================================================ */

const Render = {

  /**
   * Apply CLUB_CONFIG values to DOM elements that display club identity.
   * Called once at init before any data is fetched.
   */
  branding() {
    const { club, colors, meta, version } = Config;

    // Inject CSS custom properties from config colors
    const root = document.documentElement;
    root.style.setProperty('--color-accent',        colors.accent);
    root.style.setProperty('--color-accent-hover',  colors.accentHover);
    // accentMuted may be an 8-digit hex — convert to rgba() for broad compatibility
    root.style.setProperty('--color-accent-muted',  _hexToRgba(colors.accentMuted, 0.08));
    root.style.setProperty('--color-surface',        colors.surface);
    root.style.setProperty('--color-surface-raised', colors.surfaceRaised);
    root.style.setProperty('--color-border',         colors.surfaceBorder);
    root.style.setProperty('--color-text-primary',   colors.textPrimary);
    root.style.setProperty('--color-text-secondary', colors.textSecondary);
    root.style.setProperty('--color-text-muted',     colors.textMuted);

    // Page title and meta description
    document.title = club.siteTitle;
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl) descEl.setAttribute('content', meta.description);

    // Club name in logo and footer
    _setText('logo-club-name',  club.shortName);
    _setText('footer-club-name', club.shortName);
    _setText('footer-tagline',   club.tagline);
    _setText('footer-version',   `v${version}`);

    // Feature-flagged sections: show/hide based on config
    document.querySelectorAll('[data-feature]').forEach(el => {
      const flag = el.dataset.feature;
      const enabled = Config.features[flag];
      if (enabled === false) {
        el.hidden = true;
      } else if (enabled === true) {
        el.hidden = false;
      }
      // undefined flags: leave the DOM as-is (defaults to HTML hidden attr)
    });

    // Future hook: premium UI
    Hooks.onPremiumStateChange(Config.features.premiumEnabled);

    // Future hook: indicators UI
    Hooks.onIndicatorsStateChange(Config.features.indicatorsEnabled);
  },

  /**
   * Render the featured story section.
   * Uses the article with featured:true, or falls back to highest relevanceScore.
   */
  featured() {
    const section = document.getElementById('featured-section');
    if (!section || section.hidden) return;

    const article = _getFeaturedArticle(State.articles);
    if (!article) {
      section.hidden = true;
      return;
    }

    _setAttr('featured-image',    'src',      article.image);
    _setAttr('featured-image',    'alt',      article.imageAlt || article.title);
    _setText('featured-category', article.category ? _categoryLabel(article.category) : '');
    _setText('featured-source',   article.source);
    _setText('featured-title',    article.title);
    _setText('featured-summary',  article.summary);
    _setText('featured-date',     _formatDate(article.publishedAt));
    _setAttr('featured-date',     'datetime', article.publishedAt);

    // Wire the read button
    const btn = document.getElementById('featured-read-btn');
    if (btn) {
      btn.dataset.articleId = article.id;
      btn.setAttribute('aria-label', `Ler: ${article.title}`);
    }

    // Animate in
    const articleEl = document.getElementById('featured-article');
    if (articleEl) {
      articleEl.removeAttribute('aria-busy');
      articleEl.classList.add('is-loaded');
    }
  },

  /**
   * Build and render category filter tabs from CLUB_CONFIG.categories.
   * Uses the categories defined in config (not auto-discovered from articles)
   * so the order and labels are always consistent.
   */
  categories() {
    const nav = document.getElementById('category-nav');
    if (!nav) return;

    nav.innerHTML = '';
    const frag = document.createDocumentFragment();

    Config.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'category-tab';
      btn.role = 'tab';
      btn.dataset.category = cat.id;
      btn.textContent = cat.label;
      btn.setAttribute('aria-selected', cat.id === State.activeCategory ? 'true' : 'false');

      if (cat.id === State.activeCategory) {
        btn.classList.add('is-active');
      }

      frag.appendChild(btn);
    });

    nav.appendChild(frag);
  },

  /**
   * Render the news card grid.
   * Reads State.filtered — already category + search filtered.
   * Uses staggered animation delays for polished entrance.
   */
  feed() {
    const grid  = document.getElementById('news-grid');
    const empty = document.getElementById('news-empty');
    const error = document.getElementById('news-error');
    if (!grid) return;

    // Clear skeletons and previous cards
    grid.innerHTML = '';
    grid.removeAttribute('aria-busy');

    const articles = State.filtered;

    // Update count label
    _setText('news-count', articles.length > 0 ? `${articles.length} artigos` : '');

    // Empty state
    if (articles.length === 0) {
      if (empty) {
        const msg = document.getElementById('news-empty-message');
        if (msg) {
          msg.textContent = State.searchQuery
            ? `Nenhum resultado para "${State.searchQuery}".`
            : 'Nenhuma notícia nesta categoria.';
        }
        empty.hidden = false;
      }
      if (error) error.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (error) error.hidden = true;

    const frag = document.createDocumentFragment();

    articles.forEach((article, index) => {
      const card = Render._card(article, index);
      frag.appendChild(card);
    });

    grid.appendChild(frag);
  },

  /**
   * Build a single news card DOM element.
   * @param {Object} article — article object from State.articles
   * @param {number} index   — used for staggered animation delay
   * @returns {HTMLElement}
   */
  _card(article, index) {
    const card = document.createElement('article');
    card.className = 'news-card';
    card.setAttribute('role', 'listitem');
    card.dataset.articleId = article.id;
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', article.title);

    // Staggered entrance — cap at 600ms total
    const delay = Math.min(index * 40, 600);
    card.style.animationDelay = `${delay}ms`;

    // Premium indicator hook (future)
    if (article.premium && Config.features.premiumEnabled) {
      card.dataset.premium = 'true';
    }

    card.innerHTML = `
      <div class="news-card-body">
        <div class="news-card-meta">
          <span class="news-card-category">${_escHtml(_categoryLabel(article.category))}</span>
          <span class="news-card-source">${_escHtml(article.source)}</span>
        </div>
        <h3 class="news-card-title">${_escHtml(article.title)}</h3>
        <p class="news-card-summary">${_escHtml(article.summary)}</p>
        <time class="news-card-date" datetime="${_escHtml(article.publishedAt)}">
          ${_escHtml(_formatDate(article.publishedAt))}
        </time>
      </div>
      <div class="news-card-image-wrap">
        <img
          class="news-card-image"
          src="${_escHtml(article.image)}"
          alt="${_escHtml(article.imageAlt || article.title)}"
          loading="lazy"
          decoding="async"
          onerror="this.parentElement.hidden=true"
        />
      </div>
    `;

    return card;
  },

  /**
   * Update the header status bar (last updated + dot state).
   */
  metadata() {
    const label = document.getElementById('last-updated-label');
    if (!label) return;

    if (State.lastUpdated) {
      label.textContent = `Atualizado ${_formatRelativeTime(State.lastUpdated)}`;
      Render.statusDot('live');
    } else {
      label.textContent = 'Dados carregados';
    }
  },

  /**
   * Update the status dot visual state.
   * @param {'live'|'stale'|'error'|'loading'} state
   */
  statusDot(state) {
    const dot = document.getElementById('status-dot');
    if (!dot) return;
    dot.className = 'status-dot';
    if (state !== 'loading') dot.classList.add(`status-dot--${state}`);
  },

  /**
   * Show the error state in the news feed.
   */
  error() {
    const grid  = document.getElementById('news-grid');
    const error = document.getElementById('news-error');
    const empty = document.getElementById('news-empty');
    const label = document.getElementById('last-updated-label');

    if (grid)  grid.innerHTML = '';
    if (error) error.hidden = false;
    if (empty) empty.hidden = true;

    // Update status label — set directly on element to guarantee override
    if (label) {
      label.textContent = 'Erro ao carregar';
    }

    Render.statusDot('error');
  },

  /**
   * Open and populate the article modal.
   * @param {string} articleId
   */
  modal: {
    open(articleId) {
      const article = State.articles.find(a => a.id === articleId);
      if (!article) return;

      State.activeArticleId = articleId;
      State.isModalOpen     = true;

      // Populate fields
      _setText('modal-category',     _categoryLabel(article.category));
      _setText('modal-source',       article.source);
      _setText('modal-title',        article.title);
      _setText('modal-summary',      article.summary);
      _setText('modal-author',       article.author || '');
      _setText('modal-date',         _formatDate(article.publishedAt, true));
      _setAttr('modal-date',         'datetime', article.publishedAt);

      // Image
      _setAttr('modal-image',        'src', article.image);
      _setAttr('modal-image',        'alt', article.imageAlt || article.title);
      _setText('modal-image-credit', article.imageCredit || '');

      // Full article body — render paragraphs from plain text
      const bodyEl = document.getElementById('modal-article-body');
      if (bodyEl) {
        bodyEl.innerHTML = _renderArticleBody(article.content);
      }

      // Source link
      const sourceLink = document.getElementById('modal-source-link');
      if (sourceLink) {
        sourceLink.href = article.sourceUrl || '#';
        sourceLink.textContent = `Ler em ${article.source}`;
        // Re-append the SVG arrow icon
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '12');
        svg.setAttribute('height', '12');
        svg.setAttribute('viewBox', '0 0 12 12');
        svg.setAttribute('fill', 'none');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M2 10L10 2M10 2H4M10 2V8');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        sourceLink.appendChild(svg);
      }

      // Tags
      const tagsEl = document.getElementById('modal-tags');
      if (tagsEl && Array.isArray(article.tags)) {
        tagsEl.innerHTML = article.tags.map(tag =>
          `<span class="modal-tag">${_escHtml(tag)}</span>`
        ).join('');
      }

      // Future hooks
      Hooks.onModalOpen(article);

      // Show modal
      const backdrop = document.getElementById('modal-backdrop');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.classList.remove('is-closing');
        backdrop.classList.add('is-open');
        backdrop.setAttribute('aria-hidden', 'false');
      }

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Focus management — move focus to close button
      requestAnimationFrame(() => {
        const closeBtn = document.getElementById('modal-close');
        if (closeBtn) closeBtn.focus();
      });
    },

    close() {
      if (!State.isModalOpen) return;

      const backdrop = document.getElementById('modal-backdrop');
      if (!backdrop) return;

      backdrop.classList.remove('is-open');
      backdrop.classList.add('is-closing');

      // Wait for animation before hiding
      const duration = 280;
      setTimeout(() => {
        backdrop.hidden = true;
        backdrop.classList.remove('is-closing');
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        // Return focus to the card that triggered the modal
        if (State.activeArticleId) {
          const triggerCard = document.querySelector(
            `[data-article-id="${State.activeArticleId}"]`
          );
          if (triggerCard) triggerCard.focus();
        }

        State.isModalOpen     = false;
        State.activeArticleId = null;

        Hooks.onModalClose();
      }, duration);
    }
  }
};


/* ============================================================================
   5. SEARCH
   Real-time filtering — no server requests, purely in-memory.
   ============================================================================ */

const Search = {
  _debounceTimer: null,

  /**
   * Handle input event from the search field.
   * Debounces at 180ms to avoid thrashing on fast typists.
   */
  onInput(value) {
    clearTimeout(Search._debounceTimer);
    Search._debounceTimer = setTimeout(() => {
      Search.apply(value.trim().toLowerCase());
    }, 180);
  },

  /**
   * Apply a search query.
   * Updates State, re-renders feed, shows/hides banner and clear button.
   */
  apply(query) {
    State.searchQuery = query;
    Render.feed();
    Search._updateUI(query);
  },

  /**
   * Clear the active search.
   */
  clear() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    Search.apply('');
  },

  _updateUI(query) {
    const clearBtn = document.getElementById('search-clear');
    const banner   = document.getElementById('search-banner');
    const queryLbl = document.getElementById('search-query-label');

    if (clearBtn) clearBtn.hidden = query.length === 0;

    if (banner) {
      banner.hidden = query.length === 0;
      if (queryLbl) queryLbl.textContent = query;
    }
  }
};


/* ============================================================================
   6. CATEGORIES
   Dynamic tab activation + feed filtering.
   ============================================================================ */

const Categories = {

  /**
   * Activate a category tab and re-render the feed.
   * @param {string} categoryId — must match a category id in CLUB_CONFIG.categories
   */
  select(categoryId) {
    if (State.activeCategory === categoryId) return;

    State.activeCategory = categoryId;

    // Update tab active states
    document.querySelectorAll('.category-tab').forEach(btn => {
      const isActive = btn.dataset.category === categoryId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Render.feed();
  }
};


/* ============================================================================
   7. EVENTS
   Centralized event handling. Uses delegation on stable containers
   to avoid attaching listeners to dynamically created elements.
   ============================================================================ */

const Events = {

  attach() {
    // ── News grid: click and keyboard on cards (delegation) ──
    const grid = document.getElementById('news-grid');
    if (grid) {
      grid.addEventListener('click', Events._onCardInteract);
      grid.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          Events._onCardInteract(e);
        }
      });
    }

    // ── Featured story read button ──
    const featuredBtn = document.getElementById('featured-read-btn');
    if (featuredBtn) {
      featuredBtn.addEventListener('click', () => {
        const id = featuredBtn.dataset.articleId;
        if (id) Render.modal.open(id);
      });
    }

    // ── Category nav (delegation) ──
    const categoryNav = document.getElementById('category-nav');
    if (categoryNav) {
      categoryNav.addEventListener('click', e => {
        const tab = e.target.closest('.category-tab');
        if (tab && tab.dataset.category) {
          Categories.select(tab.dataset.category);
        }
      });
    }

    // ── Search input ──
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => Search.onInput(e.target.value));
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') Search.clear();
      });
    }

    // ── Search clear button ──
    const searchClear = document.getElementById('search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', Search.clear);
    }

    // ── Search banner clear button ──
    const bannerClear = document.getElementById('search-banner-clear');
    if (bannerClear) {
      bannerClear.addEventListener('click', Search.clear);
    }

    // ── Modal close button ──
    const modalClose = document.getElementById('modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', Render.modal.close);
    }

    // ── Modal backdrop click (close on outside click) ──
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) Render.modal.close();
      });
    }

    // ── Keyboard: Escape to close modal ──
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && State.isModalOpen) {
        Render.modal.close();
      }
    });

    // ── Retry button on error state ──
    const retryBtn = document.getElementById('news-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        State._cache = null; // force fresh fetch
        App.loadData();
      });
    }

    // ── Modal focus trap ──
    const modalContainer = document.getElementById('modal-container');
    if (modalContainer) {
      modalContainer.addEventListener('keydown', Events._trapFocus);
    }
  },

  /**
   * Handle click or keyboard activation on a news card.
   */
  _onCardInteract(e) {
    const card = e.target.closest('.news-card');
    if (card && card.dataset.articleId) {
      Render.modal.open(card.dataset.articleId);
    }
  },

  /**
   * Trap keyboard focus inside the modal while it is open.
   * Ensures Tab and Shift+Tab cycle within the modal container only.
   */
  _trapFocus(e) {
    if (!State.isModalOpen || e.key !== 'Tab') return;

    const modal = document.getElementById('modal-container');
    if (!modal) return;

    const focusable = modal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
};


/* ============================================================================
   8. HOOKS
   Stubs for future features. Called at the right lifecycle moments.
   Implement here when features are ready — no changes needed elsewhere.
   ============================================================================ */

const Hooks = {

  /**
   * Called when premium feature flag state is determined.
   * Future: show/hide premium gates, subscription CTAs, etc.
   */
  onPremiumStateChange(isEnabled) {
    // Future: if (isEnabled) PremiumModule.init();
    if (isEnabled) {
      console.info('[Constata] Premium mode enabled.');
    }
  },

  /**
   * Called when indicators feature flag state is determined.
   * Future: render governance, financial risk, confirmation indicators.
   */
  onIndicatorsStateChange(isEnabled) {
    // Future: if (isEnabled) IndicatorsModule.init();
    if (isEnabled) {
      console.info('[Constata] Indicators mode enabled.');
    }
  },

  /**
   * Called when an article modal opens.
   * Future: load related stories, timeline entries, confirmation status.
   * @param {Object} article — the full article object
   */
  onModalOpen(article) {
    // Future: RelatedStories.load(article.relatedIds);
    // Future: Timeline.loadForArticle(article.id);
    // Future: ConfirmationIndicator.render(article.confirmationLevel);
    // Future: NextMatchWidget.maybeShow(article.tags);
  },

  /**
   * Called when the modal closes.
   * Future: clean up any modal-scoped subscriptions or loaded modules.
   */
  onModalClose() {
    // Future: RelatedStories.clear();
    // Future: Timeline.clear();
  },

  /**
   * Called after each data refresh.
   * Future: trigger notification system if new articles appeared.
   * @param {Array} previousArticles
   * @param {Array} nextArticles
   */
  onDataRefresh(previousArticles, nextArticles) {
    // Future: const newCount = nextArticles.length - previousArticles.length;
    // Future: if (newCount > 0) Notifications.show(newCount);
  },

  /**
   * Called when next match data becomes available.
   * Future: populate the next match widget from a football data API.
   * @param {Object} matchData
   */
  onNextMatchData(matchData) {
    // Future: NextMatchWidget.render(matchData);
  }
};


/* ============================================================================
   9. UTILITY FUNCTIONS
   Pure helpers. No side effects, no DOM access.
   ============================================================================ */

/**
 * Sort comparator: newest first.
 */
function _sortByDate(a, b) {
  return new Date(b.publishedAt) - new Date(a.publishedAt);
}

/**
 * Find the featured article (featured:true) or fall back to highest relevanceScore.
 */
function _getFeaturedArticle(articles) {
  if (!articles.length) return null;

  const explicit = articles.find(a => a.featured === true);
  if (explicit) return explicit;

  // Fallback: highest relevanceScore
  return articles.reduce((best, a) => {
    const score = a.relevanceScore ?? 0;
    return score > (best.relevanceScore ?? 0) ? a : best;
  }, articles[0]);
}

/**
 * Look up a human-readable category label from CLUB_CONFIG.categories.
 */
function _categoryLabel(categoryId) {
  if (!categoryId) return '';
  const cat = Config.categories.find(c => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

/**
 * Format an ISO date string into a readable Brazilian Portuguese date.
 * @param {string} iso
 * @param {boolean} long — include time if true
 */
function _formatDate(iso, long = false) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (isNaN(date)) return '';

    const opts = long
      ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', year: 'numeric' };

    return date.toLocaleDateString('pt-BR', opts);
  } catch {
    return iso;
  }
}

/**
 * Format an ISO date as a relative time string ("há 2 horas", "há 3 dias").
 * Falls back to absolute date for older articles.
 */
function _formatRelativeTime(iso) {
  if (!iso) return '';
  try {
    const date  = new Date(iso);
    const now   = new Date();
    const diff  = now - date; // ms
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins  <  2)  return 'agora mesmo';
    if (mins  < 60)  return `há ${mins} min`;
    if (hours <  2)  return 'há 1 hora';
    if (hours < 24)  return `há ${hours} horas`;
    if (days  <  2)  return 'há 1 dia';
    if (days  <  7)  return `há ${days} dias`;

    return _formatDate(iso);
  } catch {
    return '';
  }
}

/**
 * Case-insensitive substring search with accent normalization.
 * @param {string} haystack
 * @param {string} needle — already lowercased
 */
function _searchText(haystack, needle) {
  if (!haystack || !needle) return false;
  return _normalize(haystack).includes(_normalize(needle));
}

/**
 * Normalize a string: lowercase + remove diacritics.
 * Allows searching "Brasília" with "brasilia".
 */
function _normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Convert plain text article content to HTML paragraphs.
 * Splits on double newlines or single newlines.
 */
function _renderArticleBody(content) {
  if (!content) return '';

  // If content already has HTML tags, use as-is (sanitization would go here in v2)
  if (/<[a-z][\s\S]*>/i.test(content)) {
    return content;
  }

  // Plain text: split into paragraphs
  return content
    .split(/\n\n+|\n/)
    .map(para => para.trim())
    .filter(para => para.length > 0)
    .map(para => `<p>${_escHtml(para)}</p>`)
    .join('');
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function _escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * Convert a 3, 6, or 8-digit hex color to an rgba() string.
 * Falls back to the original value if parsing fails.
 * Used to ensure CSS custom properties are set with compatible values.
 * @param {string} hex   — e.g. "#F5C518" or "#F5C51820"
 * @param {number} alpha — override alpha (0–1). If hex has its own alpha, that wins.
 */
function _hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return hex;
  // If it's already rgba/rgb, return as-is
  if (hex.startsWith('rgb')) return hex;

  let h = hex.replace('#', '');
  let a = alpha !== undefined ? alpha : 1;

  if (h.length === 3)      h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length === 8) {
    a = parseInt(h.slice(6, 8), 16) / 255;
    h = h.slice(0, 6);
  }
  if (h.length !== 6) return hex;

  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(3))})`;
}

/**
 * Set textContent safely.
 */
function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}

/**
 * Set an attribute safely.
 */
function _setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el && value) el.setAttribute(attr, value);
}


/* ============================================================================
   10. APP
   Orchestrates the startup sequence and data loading.
   ============================================================================ */

const App = {

  /**
   * Entry point. Called once on DOMContentLoaded.
   */
  async init() {
    console.info(`[Constata] Initializing ${Config.club.siteTitle} v${Config.version}`);

    // 1. Apply branding and feature flags immediately (before data loads)
    Render.branding();

    // 2. Render category tabs from config
    Render.categories();

    // 3. Attach all event listeners
    Events.attach();

    // 4. Set loading status
    Render.statusDot('loading');
    _setText('last-updated-label', 'Carregando…');

    // 5. Fetch and render data
    await App.loadData();

    // 6. Start auto-refresh cycle
    Data.startRefresh();
  },

  /**
   * Fetch data, ingest into State, render all data-dependent sections.
   * Called once at init and by the retry button on error.
   */
  async loadData() {
    try {
      const payload = await Data.load();
      Data.ingest(payload);

      Render.featured();
      Render.feed();
      Render.metadata();

    } catch (err) {
      console.error('[Constata] Data load failed:', err.message || err);
      console.error('[Constata] Stack:', err.stack || '(no stack)');
      State.isLoading = false;
      State.hasError  = true;
      Render.error();
    }
  }
};


/* ============================================================================
   BOOTSTRAP
   Wait for DOM to be ready, then initialize.
   ============================================================================ */

document.addEventListener('DOMContentLoaded', function onReady() {
  document.removeEventListener('DOMContentLoaded', onReady);
  App.init();
});


