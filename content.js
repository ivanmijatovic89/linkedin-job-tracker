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

  function loadData(key) {
    return new Promise(resolve =>
      chrome.storage.local.get(key, res => resolve(res[key] ?? { status: 'None', rating: 0 }))
    );
  }

  function saveData(key, value) {
    chrome.storage.local.set({ [key]: value });
  }

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

    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      sel.className = `ljt-select ljt-s-${sel.value.toLowerCase()}`;
      saveData(jobId, { status: sel.value, rating: curRating });
    });

    stars.addEventListener('mouseover', e => {
      const s = e.target.closest('.ljt-star');
      if (s) renderStars(stars, +s.dataset.v, true);
    });
    stars.addEventListener('mouseleave', () => renderStars(stars, curRating));
    stars.addEventListener('click', e => {
      e.stopPropagation();
      const s = e.target.closest('.ljt-star');
      if (!s) return;
      const v = +s.dataset.v;
      curRating = curRating === v ? 0 : v;
      renderStars(stars, curRating);
      saveData(jobId, { status: sel.value, rating: curRating });
    });

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

    card.appendChild(buildPanel(jobId, data));
    injecting.delete(card);
    watchCard(card, jobId); // ensure watcher is still attached
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

  function makeJobId(title, company) {
    return `ljt_h_${simpleHash(title + '||' + company)}`;
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

      const jobId = makeJobId(jobTitle, company);
      if (compKey) compKeyToJobId.set(compKey, jobId);
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        inject(card, jobId);
      }
    });
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
      const companyLink = container.querySelector('a[href*="/company/"]');
      const company = companyLink ? normalizeText(companyLink.textContent) : '';
      const jobId = jobTitle ? makeJobId(jobTitle, company) : `ljt_${numericId}`;

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
