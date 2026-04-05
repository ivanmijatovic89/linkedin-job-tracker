(() => {
  'use strict';

  const STATUS_OPTIONS = ['None', 'Seen', 'Applied', 'Skipped'];

  // ── Utilities ─────────────────────────────────────────────────────────────

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
  }

  function normalizeText(str) {
    return (str || '').trim().replace(/\s+/g, ' ');
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  const RESET_ONCE_KEY = 'ljt__reset_2026_04_05';

  function loadData(key) {
    return new Promise(resolve =>
      chrome.storage.local.get(key, res => resolve(res[key] ?? { status: 'None', rating: 0 }))
    );
  }

  function saveData(key, value) {
    console.log('[LJT] save', key, value);
    chrome.storage.local.set({ [key]: value });
  }

  // One-time hard reset of all stored job data (all ljt_* keys).
  chrome.storage.local.get(RESET_ONCE_KEY, res => {
    if (res[RESET_ONCE_KEY]) return;
    chrome.storage.local.get(null, all => {
      const toRemove = Object.keys(all).filter(k => k.startsWith('ljt_'));
      if (toRemove.length) chrome.storage.local.remove(toRemove);
      chrome.storage.local.set({ [RESET_ONCE_KEY]: true });
    });
  });

  // Sync all panels with the same jobId when storage changes (cross-panel live update)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    Object.entries(changes).forEach(([key, { newValue }]) => {
      if (!newValue) return;
      document.querySelectorAll(`.ljt-panel[data-ljt-id="${CSS.escape(key)}"]`).forEach(panel => {
        panel._ljtSync?.(newValue);
      });
    });
  });

  // ── UI builder ────────────────────────────────────────────────────────────

  function renderStars(wrap, active, preview = false) {
    wrap.querySelectorAll('.ljt-star').forEach(s => {
      const v = +s.dataset.v;
      s.classList.toggle('ljt-star--on', v <= active);
      s.classList.toggle('ljt-star--preview', preview && v <= active);
    });
  }

  function buildPanel(jobId, { status, rating }) {
    const panel = document.createElement('div');
    panel.className = 'ljt-panel';
    panel.setAttribute('data-ljt-id', jobId);

    const sel = document.createElement('select');
    sel.className = `ljt-select ljt-s-${status.toLowerCase()}`;
    STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === status) o.selected = true;
      sel.appendChild(o);
    });

    const stars = document.createElement('div');
    stars.className = 'ljt-stars';
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement('span');
      s.className = 'ljt-star';
      s.dataset.v = i;
      s.textContent = '★';
      stars.appendChild(s);
    }
    renderStars(stars, rating);

    panel.appendChild(sel);
    panel.appendChild(stars);

    let curRating = rating;

    // Stop all pointer/click events from bubbling out of the panel into the card's button handler
    ['mousedown', 'pointerdown', 'click'].forEach(evt =>
      panel.addEventListener(evt, e => e.stopPropagation())
    );

    sel.addEventListener('change', () => {
      sel.className = `ljt-select ljt-s-${sel.value.toLowerCase()}`;
      saveData(jobId, { status: sel.value, rating: curRating });
    });

    stars.addEventListener('mouseover', e => {
      const s = e.target.closest('.ljt-star');
      if (s) renderStars(stars, +s.dataset.v, true);
    });
    stars.addEventListener('mouseleave', () => renderStars(stars, curRating));
    stars.addEventListener('click', e => {
      const s = e.target.closest('.ljt-star');
      if (!s) return;
      const v = +s.dataset.v;
      curRating = curRating === v ? 0 : v;
      renderStars(stars, curRating);
      saveData(jobId, { status: sel.value, rating: curRating });
    });

    // Expose a sync method so the storage listener can update this panel from outside
    panel._ljtSync = ({ status: s, rating: r }) => {
      if (sel.value !== s) {
        sel.value = s;
        sel.className = `ljt-select ljt-s-${s.toLowerCase()}`;
      }
      if (curRating !== r) {
        curRating = r;
        renderStars(stars, curRating);
      }
    };

    return panel;
  }

  // ── Injection state ───────────────────────────────────────────────────────

  const injecting = new Set();
  const compKeyToJobId = new Map(); // componentkey UUID → jobId (survives element replacement)
  const watchedCards = new WeakSet(); // cards with per-card observers attached
  const injectedJobIds = new Set();   // right-panel numeric IDs already shown

  // ── Per-card watcher ──────────────────────────────────────────────────────
  // Attaches a MutationObserver directly to a card element.
  // If LinkedIn removes our panel (during re-renders), re-inject after a delay.

  function watchCard(card, jobId) {
    if (watchedCards.has(card)) return;
    watchedCards.add(card);

    const obs = new MutationObserver(() => {
      if (!card.isConnected) {
        obs.disconnect();
        return;
      }
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        // Panel was removed — wait for LinkedIn to finish its render, then re-inject
        setTimeout(() => appendPanel(card, jobId), 150);
      }
    });
    obs.observe(card, { childList: true });
  }

  // Find the inner text column of a job card (contains title, company, location, date).
  // It's the direct child of the card that contains the paragraph elements.
  function findTextContainer(card) {
    const firstP = card.querySelector('p');
    if (!firstP) return card;
    let el = firstP.parentElement;
    // Walk up until el is a direct child of card
    while (el && el.parentElement && el.parentElement !== card) {
      el = el.parentElement;
    }
    return (el && el !== card) ? el : card;
  }

  async function appendPanel(card, jobId) {
    if (!card.isConnected) return;
    if (card.querySelector('.ljt-panel')) return;
    if (injecting.has(card)) return;
    injecting.add(card);

    const data = await loadData(jobId);

    if (!card.isConnected || card.querySelector('.ljt-panel')) {
      injecting.delete(card);
      return;
    }

    // Inject into the inner text column so the panel sits below the date/apply line
    const target = findTextContainer(card);
    target.appendChild(buildPanel(jobId, data));
    injecting.delete(card);
    watchCard(card, jobId);
  }

  // First-time injection for a card
  async function inject(card, jobId) {
    if (card.querySelector('.ljt-panel')) {
      watchCard(card, jobId);
      return;
    }
    if (injecting.has(card)) return;

    await appendPanel(card, jobId);
    watchCard(card, jobId);
  }

  // ── Shared key computation ────────────────────────────────────────────────

  function makeJobId({ numericId, title, company }) {
    if (numericId) return `ljt_${numericId}`;
    return `ljt_h_${simpleHash(title + '||' + company)}`;
  }

  function isNumericJobId(jobId) {
    return /^ljt_\d+$/.test(jobId);
  }

  function getCurrentJobIdFromUrl() {
    const m = location.search.match(/[?&]currentJobId=(\d+)/);
    return m ? m[1] : '';
  }

  function rekeyPanel(card, newJobId) {
    const panel = card.querySelector('.ljt-panel');
    if (panel && panel.getAttribute('data-ljt-id') !== newJobId) {
      panel.remove();
    }
    if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
      inject(card, newJobId);
    }
  }

  function extractNumericIdFromNode(start) {
    let el = start;
    for (let i = 0; i < 12 && el && el !== document.body; i++) {
      const occl = el.getAttribute?.('data-occludable-job-id');
      if (occl) return occl;
      const dataJobId = el.getAttribute?.('data-job-id');
      if (dataJobId) return dataJobId;
      const urn = el.getAttribute?.('data-entity-urn') || '';
      const mUrn = urn.match(/jobPosting:(\d+)/);
      if (mUrn) return mUrn[1];
      el = el.parentElement;
    }
    return '';
  }

  function extractNumericIdFromCard(card, hintEl) {
    const fromHint = hintEl ? extractNumericIdFromNode(hintEl) : '';
    if (fromHint) return fromHint;
    const direct =
      card.getAttribute('data-occludable-job-id') ||
      card.querySelector('[data-occludable-job-id]')?.getAttribute('data-occludable-job-id') ||
      '';
    if (direct) return direct;
    const urnEl = card.querySelector('[data-entity-urn*="jobPosting:"]');
    const urn = urnEl?.getAttribute('data-entity-urn') || '';
    const mUrn = urn.match(/jobPosting:(\d+)/);
    if (mUrn) return mUrn[1];
    const dataJobId =
      card.getAttribute('data-job-id') ||
      card.querySelector('[data-job-id]')?.getAttribute('data-job-id') ||
      '';
    if (dataJobId) return dataJobId;
    const link = card.querySelector('a[href*="/jobs/view/"]');
    if (!link) return '';
    const m = (link.getAttribute('href') || '').match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : '';
  }

  function extractNumericIdByTitle(jobTitle, hintEl) {
    if (!jobTitle) return '';
    const targetTitle = normalizeText(jobTitle);
    const hintRect = hintEl?.getBoundingClientRect?.();
    let best = null;
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const t = normalizeText(a.textContent);
      if (!t || t !== targetTitle) return;
      const rect = a.getBoundingClientRect();
      const dx = hintRect ? Math.abs(rect.left - hintRect.left) : 0;
      const dy = hintRect ? Math.abs(rect.top - hintRect.top) : 0;
      const score = dx + dy;
      if (!best || score < best.score) {
        best = { score, href: a.getAttribute('href') || '' };
      }
    });
    if (!best || !best.href) return '';
    const m = best.href.match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : '';
  }


  // ── LEFT COLUMN ───────────────────────────────────────────────────────────

  function processLeftCards() {
    // Pass 1: re-check all known componentkeys — find them regardless of role/tag changes
    compKeyToJobId.forEach((jobId, compKey) => {
      const card = document.querySelector(`[componentkey="${compKey}"]`);
      if (!card) return; // scrolled away
      if (card.querySelector('.ljt-panel')) {
        watchCard(card, jobId);
        return;
      }
      if (!injecting.has(card)) inject(card, jobId);
    });

    // Pass 2: discover new cards via dismiss button
    document.querySelectorAll('button[aria-label^="Dismiss "]').forEach(btn => {
      // Walk up to the card container (large enough block)
      let card = btn.parentElement;
      while (card && card !== document.body) {
        const rect = card.getBoundingClientRect();
        if (rect.height > 50 && rect.width > 150) break;
        card = card.parentElement;
      }
      if (!card || card === document.body) return;

      const compKey = card.getAttribute('componentkey') || '';
      if (compKey && compKeyToJobId.has(compKey)) return; // already handled in pass 1

      const label = btn.getAttribute('aria-label') || '';
      const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
      if (!jobTitle) return;

      // Prefer LinkedIn's numeric job id if present on the card tree
      let numericId = extractNumericIdFromCard(card, btn);
      if (!numericId) {
        numericId = extractNumericIdByTitle(jobTitle, btn);
      }

      const company = [...card.querySelectorAll('p')]
        .map(p => normalizeText(p.textContent))
        .find(t =>
          t &&
          t !== jobTitle &&
          t.length < 80 &&
          !t.match(/\d+ (hour|day|week|month)/) &&
          !t.includes('applicant') &&
          !t.includes('·') &&
          !t.includes('Posted')
        ) || '';

      const jobId = makeJobId({ numericId, title: jobTitle, company });
      if (compKey) {
        const prev = compKeyToJobId.get(compKey);
        compKeyToJobId.set(compKey, jobId);
        if (prev && prev !== jobId && !isNumericJobId(prev) && isNumericJobId(jobId)) {
          chrome.storage.local.remove(prev);
        }
      }
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        inject(card, jobId);
      }
    });
  }

  // When user clicks a left card, LinkedIn updates currentJobId in URL.
  // Use that to re-key the clicked card to the numeric job id.
  let clickListenerAttached = false;
  function attachLeftCardClickListener() {
    if (clickListenerAttached) return;
    clickListenerAttached = true;
    document.addEventListener('click', e => {
      const card = e.target.closest('[componentkey][role="button"]') || e.target.closest('[componentkey]');
      if (!card) return;
      const compKey = card.getAttribute('componentkey') || '';
      if (!compKey) return;
      setTimeout(() => {
        const numericId = getCurrentJobIdFromUrl();
        if (!numericId) return;
        const newJobId = `ljt_${numericId}`;
        const prev = compKeyToJobId.get(compKey);
        compKeyToJobId.set(compKey, newJobId);
        if (prev && prev !== newJobId && !isNumericJobId(prev)) {
          chrome.storage.local.remove(prev);
        }
        rekeyPanel(card, newJobId);
      }, 0);
    }, true);
  }

  // ── RIGHT COLUMN ──────────────────────────────────────────────────────────

  function processRightPanel() {
    const seenThisScan = new Set();

    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const m = a.getAttribute('href').match(/\/jobs\/view\/(\d+)/);
      if (!m) return;
      const numericId = m[1];

      if (seenThisScan.has(numericId)) return;
      seenThisScan.add(numericId);

      let container = a.parentElement;
      while (container && container !== document.body) {
        const hasApply = container.querySelector('a[aria-label*="Apply"], button[aria-label="Save the job"]');
        const rect = container.getBoundingClientRect();
        if (hasApply && rect.height > 80) break;
        container = container.parentElement;
      }

      if (!container || container === document.body) return;

      const jobTitle = normalizeText(a.textContent);

      // Company link may be outside the container (in a header above) — walk up from title anchor
      let company = '';
      let companySearch = a.parentElement;
      for (let i = 0; i < 10 && companySearch && companySearch !== document.body; i++) {
        const cl = companySearch.querySelector('a[href*="/company/"]');
        if (cl && cl.textContent.trim()) { company = normalizeText(cl.textContent); break; }
        companySearch = companySearch.parentElement;
      }

      const jobId = makeJobId({ numericId, title: jobTitle, company });

      if (injectedJobIds.has(numericId) && !container.querySelector('.ljt-panel')) {
        injectedJobIds.delete(numericId);
      }

      if (container.querySelector('.ljt-panel')) {
        injectedJobIds.add(numericId);
        return;
      }

      injectedJobIds.clear();
      injectedJobIds.add(numericId);
      inject(container, jobId);
    });
  }

  // ── Main scan ─────────────────────────────────────────────────────────────

  function scanAll() {
    processLeftCards();
    processRightPanel();
    attachLeftCardClickListener();
  }

  // ── Observer ──────────────────────────────────────────────────────────────

  let rafId = null;
  const observer = new MutationObserver(() => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { scanAll(); rafId = null; });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  scanAll();
  setTimeout(scanAll, 1500);
  setTimeout(scanAll, 4000);
})();
